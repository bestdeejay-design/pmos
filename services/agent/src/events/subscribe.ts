import { EventBus } from "@pmos/event-bus";
import type { EventEnvelope } from "@pmos/shared";
import { eq, gte, count } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { logger } from "../lib/errors.js";
import { inDndWindow, parseDailyLimit, dailyAllowed, todayStartUtcIso } from "../lib/policy.js";
import { evaluateTaskTriggers, meetingEndedDue, buildProjectPlanBody } from "../lib/triggers.js";

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

interface MeetingUpdatedEventData {
  meetingId: string;
  title?: string;
  startTime?: string;
  endTime?: string | null;
}

interface ProjectCreatedEventData {
  id: string;
  name?: string;
  goal?: string | null;
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

/**
 * Insert an agent_message (status pending) and publish pmos.agent.message_created.
 * Applies delivery policy first: messages inside the DND window and messages
 * beyond the daily cap are skipped (logged, not inserted). Both are fail-open —
 * with no env config the behaviour is identical to before.
 */
async function createMessage(input: {
  type: string;
  source: string;
  title: string;
  body: string;
  correlationId?: string;
}): Promise<void> {
  const now = new Date();
  if (inDndWindow(now.getUTCHours(), process.env.AGENT_DND_HOURS)) {
    logger.info({ source: input.source }, "agent: message skipped — inside DND window");
    return;
  }
  const limit = parseDailyLimit(process.env.AGENT_DAILY_LIMIT);
  if (limit !== undefined) {
    const [row] = await db.select({ total: count() }).from(schema.agentMessages)
      .where(gte(schema.agentMessages.createdAt, todayStartUtcIso(now)));
    if (!dailyAllowed(row?.total ?? 0, limit)) {
      logger.info({ source: input.source }, "agent: message skipped — daily limit reached");
      return;
    }
  }

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

      const fired = evaluateTaskTriggers({
        title,
        deadline: t.deadline,
        assigneeId: t.assigneeId,
        assignee: t.assignee,
        newStatus,
      });
      for (const msg of fired) {
        await createMessage({ ...msg, correlationId: env.correlationId });
      }

      if (fired.length === 0) {
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

  // ── meetings.updated → trigger meeting_ended when the meeting has ended ──
  const onMeetingUpdated = async (env: EventEnvelope<MeetingUpdatedEventData>): Promise<void> => {
    try {
      if (await alreadyProcessed(env.id)) return;

      const { meetingId, title, endTime } = env.data;
      if (meetingEndedDue(endTime, Date.now())) {
        const label = title ?? meetingId;
        await createMessage({
          type: "suggestion",
          source: "meeting_ended",
          title: `Создать заметку по встрече «${label}»`,
          body: `Встреча «${label}» завершилась. Предлагаю создать заметку с итогами и договорённостями.`,
          correlationId: env.correlationId,
        });
      }

      await markProcessed(env.id, env.type);
    } catch (err) {
      logger.error({ err }, "agent: failed to handle meetings.updated");
      throw err;
    }
  };

  // ── projects.projects.created → trigger project_plan when a goal is present ──
  const onProjectCreated = async (env: EventEnvelope<ProjectCreatedEventData>): Promise<void> => {
    try {
      if (await alreadyProcessed(env.id)) return;

      const { id, name, goal } = env.data;
      if (goal) {
        await createMessage({
          type: "trigger",
          source: "project_plan",
          title: `План проекта «${name ?? id}»`,
          body: buildProjectPlanBody(goal),
          correlationId: env.correlationId,
        });
      }

      await markProcessed(env.id, env.type);
    } catch (err) {
      logger.error({ err }, "agent: failed to handle projects.created");
      throw err;
    }
  };

  // Subscribe to both the canonical (pmos.<svc>.<resource>.<action>) and the
  // legacy events.yaml channel names — whichever the publisher actually emits.
  await bus.subscribe<StatusChangedEventData>("pmos.tasks.status_changed", onTaskStatusChanged);
  await bus.subscribe<StatusChangedEventData>("pmos.tasks.tasks.status_changed", onTaskStatusChanged);
  await bus.subscribe<MeetingCreatedEventData>("pmos.meetings.created", onMeetingCreated);
  await bus.subscribe<MeetingCreatedEventData>("pmos.calendar.meetings.created", onMeetingCreated);
  await bus.subscribe<MeetingUpdatedEventData>("pmos.meetings.updated", onMeetingUpdated);
  await bus.subscribe<MeetingUpdatedEventData>("pmos.calendar.meetings.updated", onMeetingUpdated);
  await bus.subscribe<ProjectCreatedEventData>("pmos.projects.created", onProjectCreated);
  await bus.subscribe<ProjectCreatedEventData>("pmos.projects.projects.created", onProjectCreated);

  logger.info({ service: "agent" }, "subscribers registered");
}