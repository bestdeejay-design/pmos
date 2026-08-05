import { and, eq, lte } from "drizzle-orm";
import { db } from "../db/connection.js";
import { reminders as remindersTable, meetings } from "../db/schema.js";
import { publishcalendarEvent } from "../events/publish.js";
import { logger } from "../lib/errors.js";

interface ReminderPayload {
  meeting_id: string;
  title: string;
  start_time: string;
  fire_at: string;
}

export async function fireDueReminders(): Promise<number> {
  const now = new Date().toISOString();
  const due = await db.select().from(remindersTable)
    .where(and(lte(remindersTable.remindAt, now), eq(remindersTable.sent, false)))
    .limit(100);

  let fired = 0;
  for (const r of due) {
    const [meeting] = await db.select().from(meetings)
      .where(eq(meetings.id, r.meetingId)).limit(1);
    if (!meeting) {
      logger.warn({ meetingId: r.meetingId, reminderId: r.id }, "due reminder references missing meeting — skip");
      continue;
    }
    const payload: ReminderPayload = {
      meeting_id: meeting.id,
      title: meeting.title,
      start_time: meeting.startTime,
      fire_at: r.remindAt,
    };
    await db.update(remindersTable).set({ sent: true }).where(eq(remindersTable.id, r.id));
    await publishcalendarEvent("meetings.reminder", payload, meeting.updatedAt);
    fired += 1;
    logger.info({ reminderId: r.id, meetingId: meeting.id }, "reminder fired");
  }
  return fired;
}