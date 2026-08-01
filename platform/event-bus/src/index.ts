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

import { connect, consumerOpts, createInbox, type NatsConnection, type JetStreamClient, type JetStreamManager, StringCodec, type PubAck } from "nats";
import type { EventEnvelope } from "@pmos/shared";

const sc = StringCodec();

export interface EventBusConfig {
  url?: string;
  serviceName: string;
  /** default schema version for events published by this service */
  eventVersion?: number;
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

  /** Subscribe to a subject. handler receives the parsed EventEnvelope.
   *  Uses NATS JetStream callback-style with explicit ack + redelivery. */
  async subscribe<T = Record<string, unknown>>(
    subject: string,
    handler: (env: EventEnvelope<T>) => Promise<void>,
    opts?: { durable?: string; queue?: string },
  ): Promise<void> {
    if (!this.js) await this.connect();
    const js = this.js!;
    // Push consumer via the builder API — nats.js requires a deliver inbox and
    // an explicit ack policy; a bare options object silently breaks.
    const co = consumerOpts();
    // Ephemeral push consumer — only live events, no full-stream replay.
    co.deliverNew();
    if (opts?.durable) co.durable(opts.durable);
    if (opts?.queue) co.deliverGroup(opts.queue);
    co.ackExplicit();
    co.maxDeliver(3);
    co.ackWait(30_000);
    co.deliverTo(createInbox());
    co.manualAck();
    co.callback((err, msg) => {
      if (err) { console.error(`[event-bus] subscribe error on ${subject}:`, err); return; }
      if (!msg) return;
      try {
        const env = JSON.parse(sc.decode(msg.data)) as EventEnvelope<T>;
        void handler(env).then(
          () => msg.ack(),
          (e) => { msg.nak(); console.error(`[event-bus] handler failed for ${subject}:`, e); },
        );
      } catch (e) {
        msg.nak();
        console.error(`[event-bus] handler failed for ${subject}:`, e);
      }
    });
    await js.subscribe(subject, co);
  }

  async requestReply<TReq, TRes>(subject: string, data: TReq, timeoutMs = 5000): Promise<TRes> {
    if (!this.nc) await this.connect();
    const res = await this.nc!.request(subject, sc.encode(JSON.stringify(data)), { timeout: timeoutMs });
    return JSON.parse(sc.decode(res.data)) as TRes;
  }

  async close(): Promise<void> {
    if (this.nc) await this.nc.drain();
    this.nc = null;
    this.js = null;
    this.jsm = null;
    EventBus.instance = null;
  }
}
