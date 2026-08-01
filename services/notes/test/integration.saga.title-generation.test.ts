import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { connect, StringCodec } from "nats";
import { EventBus } from "@pmos/event-bus";
import { eq, inArray } from "drizzle-orm";
import { buildApp as buildNotesApp } from "../src/app.js";
import { buildApp as buildAiGatewayApp } from "../../ai-gateway/src/app.js";
import { db } from "../src/db/connection.js";
import { notes, processedEvents } from "../src/db/schema.js";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const HAS_NATS = Boolean(process.env.NATS_URL);
const BODY = "Тестовый текст для генерации заголовка о полёте на Марс";

// Durable consumer names used by the services (must match service code).
const DURABLE_CONSUMERS = [
  "ai-gateway-title-gen",
  "ai-gateway-title-gen-canonical",
  "notes-ai-title",
] as const;
const STREAM = "TSSRUP";

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs: number, intervalMs = 250): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== undefined && v !== null) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

async function deleteDurableConsumers(): Promise<void> {
  const bus = EventBus.get();
  // Access private jsm via type assertion — test-only cleanup.
  const jsm = (bus as unknown as { jsm: { consumers: { delete: (stream: string, consumer: string) => Promise<void> } } }).jsm;
  if (!jsm) return;
  for (const consumer of DURABLE_CONSUMERS) {
    try {
      await jsm.consumers.delete(STREAM, consumer);
    } catch {
      // Ignore — consumer may not exist.
    }
  }
}

describe.skipIf(!HAS_DB || !HAS_NATS)("saga §1: note creation + AI title generation (real NATS + Postgres)", () => {
  let notesApp: Awaited<ReturnType<typeof buildNotesApp>>;
  let aiGatewayApp: Awaited<ReturnType<typeof buildAiGatewayApp>>;
  const noteIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(async () => {
    // Both sides of the saga must be live: ai-gateway generates the title,
    // notes applies it. Both subscribe on the SAME NATS JetStream stream.
    EventBus.init({ serviceName: "saga-test", url: process.env.NATS_URL });
    await EventBus.get().connect();
    await EventBus.get().ensureStream();
    // Clean up any leftover durable consumers from previous runs BEFORE the
    // services bind their subscribers (stale consumers would swallow events).
    await deleteDurableConsumers();
    notesApp = await buildNotesApp();
    aiGatewayApp = await buildAiGatewayApp();
    await notesApp.ready();
    await aiGatewayApp.ready();
  });

  afterAll(async () => {
    if (noteIds.length) await db.delete(notes).where(inArray(notes.id, noteIds));
    if (eventIds.length) await db.delete(processedEvents).where(inArray(processedEvents.eventId, eventIds));
    await notesApp?.close();
    await aiGatewayApp?.close();
    // Clean up durable consumers while the EventBus connection is still open.
    await deleteDurableConsumers();
    await EventBus.get().close().catch(() => {});
  });

  it("end-to-end: notes.created → ai-gateway title_generated → notes updates title", async () => {
    const [row] = await db.insert(notes).values({ title: "", bodyMd: BODY, profileIds: [] }).returning();
    noteIds.push(row.id);

    await EventBus.get().publish(
      "pmos.notes.notes.created",
      { id: row.id, title: "", bodyMd: BODY, profileIds: [] },
      { correlationId: crypto.randomUUID() },
    );

    const updated = await waitFor(async () => {
      const [n] = await db.select({ id: notes.id, title: notes.title }).from(notes)
        .where(eq(notes.id, row.id)).limit(1);
      return n && n.title.length > 0 ? n : undefined;
    }, 15_000);

    expect(updated, "note title should be filled by the saga (LLM or heuristic)").toBeDefined();
    expect(updated?.title).toBeDefined();
    expect(updated?.title).not.toBe("");
  });

  it("idempotent: the same notes.created event is processed exactly once", async () => {
    const [row] = await db.insert(notes).values({ title: "", bodyMd: BODY, profileIds: [] }).returning();
    noteIds.push(row.id);
    const eventId = crypto.randomUUID();
    eventIds.push(eventId);

    const envelope = {
      id: eventId,
      type: "pmos.notes.notes.created",
      source: "saga-test",
      timestamp: new Date().toISOString(),
      version: 1,
      correlationId: crypto.randomUUID(),
      data: { id: row.id, title: "", bodyMd: BODY, profileIds: [] },
    };
    // Publish the SAME envelope twice (at-least-once redelivery) via raw NATS so
    // the event id is identical — EventBus.publish would mint a fresh id per call.
    const nc = await connect({ servers: process.env.NATS_URL });
    const sc = StringCodec();
    const payload = sc.encode(JSON.stringify(envelope));
    nc.publish("pmos.notes.notes.created", payload);
    nc.publish("pmos.notes.notes.created", payload);
    await nc.flush();
    await nc.close();

    const updated = await waitFor(async () => {
      const [n] = await db.select({ id: notes.id, title: notes.title }).from(notes)
        .where(eq(notes.id, row.id)).limit(1);
      return n && n.title.length > 0 ? n : undefined;
    }, 15_000);
    expect(updated, "note should get its title on the first delivery").toBeDefined();

    // Give the second delivery a chance to (wrongly) reprocess before asserting.
    await new Promise((r) => setTimeout(r, 1_000));
    const claimed = await db.select().from(processedEvents).where(eq(processedEvents.eventId, eventId));
    expect(claimed.length).toBe(1);
  });
});
