import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Notes service schema — schema `notes_` (ADR-004).
 * Tables: notes, templates, note_links.
 * cross-service refs (profile_ids, linked_project_id, linked_meeting_id, linked_task_id)
 * are stored as UUIDs only — schema isolation, no FK across schemas (ADR-004/ADR-007).
 */

export const notes = pgTable("notes_", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull().default(""),
  tags: text("tags").array().notNull().default([]),
  profileIds: uuid("profile_ids").array().notNull().default([]),
  linkedProjectId: uuid("linked_project_id"),
  linkedMeetingId: uuid("linked_meeting_id"),
  linkedTaskId: uuid("linked_task_id"),
  isArchived: boolean("is_archived").notNull().default(false),
  // manual ordering (drag-and-drop) — lower = higher
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});

export const templates = pgTable("templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  bodyMd: text("body_md").notNull().default(""),
  profileId: uuid("profile_id"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});

export const noteLinks = pgTable("note_links", {
  noteId: uuid("note_id").notNull(),
  linkedNoteId: uuid("linked_note_id").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.noteId, t.linkedNoteId] }),
}));

export const notesRelations = relations(notes, ({ many }) => ({
  links: many(noteLinks),
}));

export type NoteRow = typeof notes.$inferSelect;
export type NoteInsert = typeof notes.$inferInsert;
export type TemplateRow = typeof templates.$inferSelect;
export type NoteLinkRow = typeof noteLinks.$inferSelect;
