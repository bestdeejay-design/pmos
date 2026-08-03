/**
 * @pmos/event-bus — NATS JetStream SDK wrapper for ЦУП services.
 *
 * Provides:
 *  - connect(): singleton connection to NATS
 *  - publish(subject, data): strongly-typed event publish with EventEnvelope
 *  - subscribe(subject, handler): durable, idempotent-friendly consumer
 *  - requestReply(subject, data, timeout): sync request/response
 *
 * Convention: subject = "pmos.<service>.<event>" (see contracts/asyncapi/events.yaml).
 * Every published message is an EventEnvelope with version + correlationId (ADR-007 §3).
 */

import { connect, consumerOpts, createInbox, type NatsConnection, type JetStreamClient, type JetStreamManager, StringCodec, type PubAck, DeliverPolicy, AckPolicy } from "nats";
import type { EventEnvelope } from "@pmos/shared";

const sc = StringCodec();

export interface EventBusConfig {
  url?: string;
  serviceName: string;
  /** default schema version for events published by this service */
  eventVersion?: number;
}

export interface DlqEntry {
  seq: number;
  subject: string;
  data: EventEnvelope | null;
}

export class EventBus {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private cfg: EventBusConfig;
  private static instance: EventBus | null = null;

  private constructor(cfg: EventBusConfig) {
    this.cfg = cfg;
  }

  static init(cfg: EventBusConfig): EventBus {
    if (!EventBus.instance) EventBus.instance = new EventBus(cfg);
    return EventBus.instance;
  }

  static get(): EventBus {
    if (!EventBus.instance) throw new Error("EventBus not initialized — call EventBus.init() first");
    return EventBus.instance;
  }

  async connect(): Promise<void> {
    if (this.nc && this.nc.info) return;
    const url = this.cfg.url ?? process.env.NATS_URL ?? "nats://localhost:4222";
    this.nc = await connect({ servers: url });
    this.js = this.nc.jetstream();
    this.jsm = await this.nc.jetstreamManager();
  }

  async ensureStream(stream = "TSSRUP", subjects = ["pmos.>"]): Promise<void> {
    if (!this.jsm) await this.connect();
    const streams = await this.jsm!.streams.list().next();
    const exists = streams && (await this.streamExists(stream));
    if (!exists) {
      await this.jsm!.streams.add({ name: stream, subjects });
    }
  }

  private async streamExists(name: string): Promise<boolean> {
    try {
      await this.jsm!.streams.info(name);
      return true;
    } catch {
      return false;
    }
  }

  /** Publish a typed event. Builds the EventEnvelope automatically. */
  async publish<T>(type: string, data: T, opts?: { correlationId?: string; version?: number }): Promise<PubAck> {
    if (!this.js) await this.connect();
    const envelope: EventEnvelope<T> = {
      id: crypto.randomUUID(),
      type,
      source: this.cfg.serviceName,
      timestamp: new Date().toISOString(),
      version: opts?.version ?? this.cfg.eventVersion ?? 1,
      correlationId: opts?.correlationId ?? crypto.randomUUID(),
      data,
    };
    return this.js!.publish(type, sc.encode(JSON.stringify(envelope)));
  }

/** co Subscribe to a subject. handler receives the parsed EventEnvelope.
 *  Uses NATS JetStream callback-style with explicit ack + redelivery.
 *
 *  Dead-letter: when a handler keeps failing past `maxDeliver`, a copy of the
 *  message is published to `${subject}.dlq` (preserving the raw envelope bytes)
 *  and the original is terminated. That lets an admin panel (`ops` service) list
 *  and replay DLQ messages per contracts/asyncapi/events.yaml / SAGA.md §DLQ. */
  async subscribe<T = Record<string, unknown>>(
    subject: string,
    handler: (env: EventEnvelope<T>) => Promise<void>,
    opts?: { durable?: string; queue?: string; maxDeliver?: number; ackWaitMs?: number },
  ): Promise<void> {
    if (!this.js) await this.connect();
    const js = this.js!;
    const maxDeliver = opts?.maxDeliver ?? 3;
    // Push consumer via the builder API — nats.js requires a deliver inbox and
    // an explicit ack policy; a bare options object silently breaks.
    const co = consumerOpts();
    co.deliverNew();
    if (opts?.durable) co.durable(opts.durable);
    if (opts?.queue) co.deliverGroup(opts.queue);
    co.ackExplicit();
    co.maxDeliver(maxDeliver);
    co.ackWait(opts?.ackWaitMs ?? 30_000);
    co.deliverTo(createInbox());
    co.manualAck();
    co.callback((err, msg) => {
      if (err) { console.error(`[event-bus] subscribe error on ${subject}:`, err); return; }
      if (!msg) return;
      const onFailure = (e: unknown): void => {
        const delivery = (msg.info?.redeliveryCount ?? 0) + 1;
        if (delivery >= maxDeliver) {
          js.publish(`${subject}.dlq`, msg.data).then(
            () => { msg.term("dlq: max_deliver exceeded"); },
            (pe) => { console.error(`[event-bus] DLQ publish failed for ${subject}:`, pe); msg.nak(); },
          );
        } else {
          msg.nak();
        }
        console.error(`[event-bus] handler failed for ${subject}:`, e);
      };
      try {
        const env = JSON.parse(sc.decode(msg.data)) as EventEnvelope<T>;
        void handler(env).then(
          () => msg.ack(),
          onFailure,
        );
      } catch (e) {
        onFailure(e);
      }
    });
    await js.subscribe(subject, co);
  }

  /** List up to `limit` messages currently stored on the DLQ subjects (`*.dlq`).
   *  Uses an ephemeral pull-filter consumer so nothing is acknowledged or deleted.
   *  Scans only the recent tail of the stream (windowed by `tailWindow`), because
   *  fetch() reads forward from the consumer start — the DLQ messages we care about
   *  are the freshest ones. */
  async listDlq(limit = 100, tailWindow = 5_000): Promise<DlqEntry[]> {
    if (!this.jsm || !this.js) await this.connect();
    const jsm = this.jsm!;
    const stream = "TSSRUP";
    const info = await jsm.streams.info(stream);
    const lastSeq = info.state.last_seq;
    const name = `dlq-lister-${crypto.randomUUID().slice(0, 8)}`;
    await jsm.consumers.add(stream, {
      name,
      filter_subject: "pmos.>",
      deliver_policy: DeliverPolicy.StartSequence,
      opt_start_seq: Math.max(1, lastSeq - tailWindow + 1),
      ack_policy: AckPolicy.None,
      inactive_threshold: 5_000_000_000, // nanoseconds — room before the lister unsubscribes
    });
    const consumer = await this.js!.consumers.get(stream, name);
    const entries: DlqEntry[] = [];
    try {
      // Keep fetching batches until we've seen the whole tail window (a short
      // batch means the stream end was reached).
      for (;;) {
        const msgs = await consumer.fetch({ max_messages: 200, expires: 3000 });
        let got = 0;
        for await (const m of msgs) {
          got++;
          if (!m.subject.endsWith(".dlq")) continue;
          let data: EventEnvelope | null = null;
          try { data = JSON.parse(sc.decode(m.data)) as EventEnvelope; } catch { data = null; }
          entries.push({ seq: m.seq, subject: m.subject, data });
          if (entries.length >= limit) break;
        }
        if (entries.length >= limit || got < 200) break;
      }
    } finally {
      await consumer.delete().catch(() => undefined);
    }
    return entries;
  }

  /** Re-publish a DLQ'd message (by stream sequence) back to its original subject,
   *  then delete it from the DLQ. Returns the original subject it was replayed to. */
  async replayDlq(seq: number, stream = "TSSRUP"): Promise<string> {
    if (!this.jsm || !this.js) await this.connect();
    const jsm = this.jsm!;
    const stored = await jsm.streams.getMessage(stream, { seq });
    const dlqSubject = stored.subject;
    if (!dlqSubject.endsWith(".dlq")) {
      throw new Error(`subject ${dlqSubject} is not a .dlq message`);
    }
    const original = dlqSubject.replace(/\.dlq$/, "");
    await this.js!.publish(original, stored.data);
    await jsm.streams.deleteMessage(stream, seq);
    return original;
  }

  async requestReply<TReq, TRes>(subject: string, data: TReq, timeoutMs = 5000): Promise<TRes> {
    if (!this.nc) await this.connect();
    const res = await this.nc!.request(subject, sc.encode(JSON.stringify(data)), { timeout: timeoutMs });
    return JSON.parse(sc.decode(res.data)) as TRes;
  }

  isHealthy(): boolean {
    return this.nc !== null && !this.nc.isClosed() && !this.nc.isDraining();
  }

  async close(): Promise<void> {
    if (this.nc) await this.nc.drain();
    this.nc = null;
    this.js = null;
    this.jsm = null;
    EventBus.instance = null;
  }
}
