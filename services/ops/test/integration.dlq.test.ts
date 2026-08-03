import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { EventBus } from "@pmos/event-bus";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function natsReachable(): Promise<boolean> {
  try {
    const bus = EventBus.init({ serviceName: "ops-test" });
    await bus.connect();
    await bus.ensureStream();
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!process.env.NATS_URL)("ops DLQ panel (real NATS): publish → 3 fails → DLQ → replay", () => {
  let app: any;
  let bus: any;
  const subject = "pmos.ops.dlqtest." + randomUUID();

  beforeAll(async () => {
    if (!(await natsReachable())) return;
    bus = EventBus.init({ serviceName: "ops-test", url: process.env.NATS_URL });
    await bus.connect();
    await bus.ensureStream();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (bus) await bus.close().catch(() => {});
  });

  it("a handler failing maxDeliver times parks the event on .dlq and replay re-publishes it", async () => {
    // Consumer subscribed to our unique subject, always failing the handler.
    await bus.subscribe(subject, async () => {
      throw new Error("intentional failure");
    }, { maxDeliver: 3, ackWaitMs: 50, queue: "ops-dlqtest" });

    await bus.publish(subject, { hello: "world", attempt: 0 });

    // Wait for JetStream to exhaust maxDeliver and park the copy on <subject>.dlq.
    let dlqSeq: number | null = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const list = await EventBus.get().listDlq(100);
      const hit = list.find((e) => e.subject === `${subject}.dlq`);
      if (hit) {
        dlqSeq = hit.seq;
        expect(hit.data).toBeTruthy();
        expect((hit.data as any).type).toBe(subject);
        break;
      }
      await sleep(300);
    }
    expect(dlqSeq).not.toBeNull();
    if (dlqSeq === null) throw new Error("DLQ message not parked in time");

    // The ops HTTP API exposes it.
    const listed = await app.inject({ method: "GET", url: "/api/ops/v1/dlq" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.some((e: any) => e.seq === dlqSeq)).toBe(true);

    // Replay removes it from the DLQ and re-publishes to the original subject.
    const replayed = await app.inject({ method: "POST", url: `/api/ops/v1/dlq/${dlqSeq}/replay` });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().subject).toBe(subject);
    expect(replayed.json().seq).toBe(dlqSeq);

    // After replay the subject is no longer in the DLQ listing.
    const after = await EventBus.get().listDlq(100);
    expect(after.find((e) => e.seq === dlqSeq)).toBeUndefined();
  });

  it("replay of an unknown seq returns 404", async () => {
    // A deliberately bogus, very large seq — nats returns no message.
    const res = await app.inject({ method: "POST", url: "/api/ops/v1/dlq/99999999/replay" });
    expect(res.statusCode).toBe(404);
  });

  it("replay with a non-integer id is rejected with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ops/v1/dlq/abc/replay" });
    expect(res.statusCode).toBe(400);
  });
});