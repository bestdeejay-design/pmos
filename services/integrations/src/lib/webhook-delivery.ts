import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { webhooks, webhookDeliveries } from "../db/schema.js";
import type { EventEnvelope } from "@pmos/shared";
import type { WebhookRow, WebhookDeliveryRow } from "../db/schema.js";

/**
 * Webhook delivery engine (integrations).
 *
 * Design:
 *  - `scheduleWebhookDeliveries(env)` is called from the NATS subscriber. It ONLY
 *    inserts `webhook_deliveries` rows and arms `setTimeout` chains — it never
 *    performs HTTP in the NATS callback, so the JetStream ack is immediate and a
 *    slow webhook URL can never block the event bus.
 *  - Each delivery attempt POSTs the full EventEnvelope to the webhook URL with
 *    an HMAC-SHA256 signature header (X-Webhook-Signature), a 10s AbortController
 *    timeout and retry backoff [1s, 5s, 30s]. 2xx → delivered, 4xx → failed_4xx
 *    (no retry), 5xx/timeout/network → retry, then "dead" (DLQ state).
 */

export const RETRY_BACKOFF_MS = [1_000, 5_000, 30_000];
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Normalise an event type/subject to its short form (last two dot-separated
 * tokens), e.g. "pmos.notes.notes.created" -> "notes.created",
 * "pmos.notes.created" -> "notes.created", "notes.created" -> "notes.created".
 * Webhooks declare events in the catalog form ("notes.created", see
 * contracts/openapi/integrations.yaml) while wire subjects are
 * "pmos.notes.notes.created" (contracts/asyncapi/events.yaml §x-implemented-wire-events);
 * normalising both sides to the same key makes matching version-agnostic.
 */
export function normalizeEventKey(type: string): string {
  const parts = String(type ?? "").split(".").filter(Boolean);
  return parts.slice(-2).join(".");
}

/** True when the webhook's events array covers the given envelope type. */
export function eventMatches(events: string[] | null | undefined, type: string): boolean {
  if (!Array.isArray(events) || events.length === 0) return false;
  const key = normalizeEventKey(type);
  return events.some((e) => normalizeEventKey(e) === key || e === type);
}

async function matchingWebhooks(eventType: string): Promise<WebhookRow[]> {
  const active = await db.select().from(webhooks).where(eq(webhooks.active, true));
  return active.filter((w) => eventMatches(w.events, eventType));
}

/**
 * Enqueue a delivery for every active webhook subscribed to `env.type`.
 * Fire-and-forget from the subscriber's perspective: only DB inserts + timer
 * arming happen here.
 */
export async function scheduleWebhookDeliveries(env: EventEnvelope): Promise<void> {
  const matches = await matchingWebhooks(env.type);
  if (matches.length === 0) return;
  for (const webhook of matches) {
    const [delivery] = await db.insert(webhookDeliveries).values({
      webhookId: webhook.id,
      eventId: env.id ?? null,
      eventType: env.type,
      payload: env as unknown as Record<string, unknown>,
      status: "pending",
      attempts: 0,
    }).returning();
    if (delivery) scheduleAttempt(delivery.id, 0);
  }
}

function scheduleAttempt(deliveryId: string, delayMs: number): void {
  setTimeout(() => {
    attemptDelivery(deliveryId).catch((e) => {
      console.error("[webhook-delivery] attemptDelivery failed:", e);
    });
  }, delayMs);
}

/** Perform one HTTP delivery attempt, then decide retry / terminal state. */
export async function attemptDelivery(deliveryId: string): Promise<void> {
  const [delivery] = await db.select().from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId)).limit(1);
  if (!delivery) return;
  const [webhook] = await db.select().from(webhooks)
    .where(eq(webhooks.id, delivery.webhookId)).limit(1);
  if (!webhook) {
    await markDelivery(deliveryId, { status: "dead", lastError: "webhook not found" });
    return;
  }

  const attempts = (delivery.attempts ?? 0) + 1;
  const body = JSON.stringify(delivery.payload ?? {});
  const signature = createHmac("sha256", webhook.secret ?? "").update(body).digest("hex");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Signature": signature,
    "X-Event-Type": normalizeEventKey(delivery.eventType),
    "X-Correlation-Id": String((delivery.payload as Record<string, unknown> | null)?.correlationId ?? ""),
  };

  let status: "delivered" | "failed_4xx" | "retry" = "retry";
  let lastError: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (resp.ok) {
      status = "delivered";
    } else if (resp.status >= 400 && resp.status < 500) {
      status = "failed_4xx";
      lastError = `HTTP ${resp.status}`;
    } else {
      lastError = `HTTP ${resp.status}`;
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }

  if (status === "delivered") {
    await markDelivery(deliveryId, { status, attempts, lastError: null, nextRetryAt: null });
    return;
  }
  if (status === "failed_4xx") {
    await markDelivery(deliveryId, { status, attempts, lastError });
    return;
  }
  // Retryable failure (5xx / timeout / network). attempts-1 indexes the backoff list.
  const retryIndex = attempts - 1;
  if (retryIndex >= RETRY_BACKOFF_MS.length) {
    await markDelivery(deliveryId, { status: "dead", attempts, lastError });
    return;
  }
  const delayMs = RETRY_BACKOFF_MS[retryIndex] ?? 0;
  const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
  await markDelivery(deliveryId, { attempts, lastError, nextRetryAt });
  scheduleAttempt(deliveryId, delayMs);
}

type DeliveryPatch = Partial<Pick<WebhookDeliveryRow, "status" | "attempts" | "lastError" | "nextRetryAt">>;

function markDelivery(deliveryId: string, patch: DeliveryPatch): Promise<unknown> {
  return db.update(webhookDeliveries).set(patch).where(eq(webhookDeliveries.id, deliveryId));
}
