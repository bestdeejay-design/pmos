import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { logger } from "../lib/errors.js";

// Wire data shapes (camelCase per ADR-007 §3). Tolerant: `task` snapshot fields
// may arrive as assigneeId (events.yaml) or assignee (@pmos/shared).
interface StatusChangedTask {
  id?: string;
  title?: string;
  deadline?: string | null;
  assigneeId?: string | null;
  assignee?: string | null;
  projectId?: string | null;
  status?: string;
}

interface StatusChangedEventData {
  taskId: string;
  oldStatus?: string;
  newStatus?: string;
  task?: StatusChangedTask;
  changedAt?: string;
}

interface MeetingCreatedEventData {
  meetingId: string;
  title: string;
  startTime: string;
  endTime: string;
}

// Best-effort publish — a dead NATS must never break an event handler.
function publish(subject: string, data: unknown, correlationId?: string): void {
  try {
    EventBus.get()
      .publish(subject, data, { correlationId })
      .catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch {
    /* EventBus not initialised — skip */
  }
}

/** Insert an agent_message (status pending) and publish pmos.agent.message_created. */
async function createMessage(input: {
  type: string;
  source: string;
  title: string;
  body: string;
  correlationId?: string;
}): Promise<void> {
  const [row] = await db.insert(schema.agentMessages).values({
    title: input.title,
    body: input.body,
    type: input.type,
    source: input.source,
  }).returning({ id: schema.agentMessages.id });
  if (row) {
    publish("pmos.agent.message_created", {
      messageId: row.id,
      title: input.title,
      body: input.body,
      type: input.type,
      source: input.source,
    }, input.correlationId);
  }
}

/** True if the event id is already recorded (at-least-once → idempotent handlers). */
async function alreadyProcessed(eventId: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.processedEvents.id }).from(schema.processedEvents)
    .where(eq(schema.processedEvents.eventId, eventId)).limit(1);
  return Boolean(row);
}

async function markProcessed(eventId: string, eventType: string): Promise<void> {
  await db.insert(schema.processedEvents).values({ eventId, eventType }).onConflictDoNothing();
}

export async function registerSubscribers(bus: EventBus): Promise<void> {
  // ── tasks.status_changed → evaluate deadline_soon / task_no_assignee triggers ──
  const onTaskStatusChanged = async (env: EventEnvelope<StatusChangedEventData>): Promise<void> => {
    try {
      if (await alreadyProcessed(env.id)) return;

      const { taskId, newStatus, task } = env.data;
      const t = task ?? {};
      const title = t.title ?? taskId;

      await db.insert(schema.dailyEvents).values({
        kind: "task",
        title,
        startTime: t.deadline ?? null,
        data: env.data,
      }).onConflictDoNothing();

      let fired = false;
      if (newStatus !== "done" && t.deadline) {
        const hours = (new Date(t.deadline).getTime() - Date.now()) / 3_600_000;
        if (hours >= 0 && hours <= 24) {
          const rounded = Math.max(1, Math.round(hours));
          await createMessage({
            type: "trigger",
            source: "deadline_soon",
            title: `Дедлайн задачи «${title}»`,
            body: `Дедлайн задачи «${title}» через ${rounded} ч`,
            correlationId: env.correlationId,
          });
          fired = true;
        }
      }

      const assignee = t.assigneeId ?? t.assignee;
      if (!assignee) {
        await createMessage({
          type: "suggestion",
          source: "task_no_assignee",
          title: "Задача без исполнителя",
          body: `Задача «${title}» без назначенного исполнителя`,
          correlationId: env.correlationId,
        });
        fired = true;
      }

      if (!fired) {
        publish("pmos.agent.trigger_evaluated", { triggered: false }, env.correlationId);
      }

      await markProcessed(env.id, env.type);
    } catch (err) {
      logger.error({ err }, "agent: failed to handle tasks.status_changed");
      throw err;
    }
  };

  // ── meetings.created → cache meeting for /today and /week digests ──
  const onMeetingCreated = async (env: EventEnvelope<MeetingCreatedEventData>): Promise<void> => {
    try {
      if (await alreadyProcessed(env.id)) return;

      const { meetingId, title, startTime } = env.data;
      await db.insert(schema.dailyEvents).values({
        kind: "meeting",
        title: title ?? meetingId,
        startTime: startTime ?? null,
        data: env.data,
      }).onConflictDoNothing();

      await markProcessed(env.id, env.type);
    } catch (err) {
      logger.error({ err }, "agent: failed to handle meetings.created");
      throw err;
    }
  };

  // Subscribe to both the canonical (pmos.<svc>.<resource>.<action>) and the
  // legacy events.yaml channel names — whichever the publisher actually emits.
  await bus.subscribe<StatusChangedEventData>("pmos.tasks.status_changed", onTaskStatusChanged);
  await bus.subscribe<StatusChangedEventData>("pmos.tasks.tasks.status_changed", onTaskStatusChanged);
  await bus.subscribe<MeetingCreatedEventData>("pmos.meetings.created", onMeetingCreated);
  await bus.subscribe<MeetingCreatedEventData>("pmos.calendar.meetings.created", onMeetingCreated);

  logger.info({ service: "agent" }, "subscribers registered");
}
