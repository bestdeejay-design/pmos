import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Tasks service schema — schema `tasks_` (ADR-004).
 * Tables: tasks, task_dependencies.
 * Cross-service refs (profile_ids, project_id, assignee, linked_task) are UUIDs only.
 */

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("todo"), // todo | in_progress | done
  priority: integer("priority").notNull().default(0),
  description: text("description"),
  assignee: text("assignee"),
  deadline: timestamp("deadline", { mode: "string", withTimezone: true }),
  projectId: uuid("project_id"),
  profileIds: uuid("profile_ids").array().notNull().default([]),
  recurrence: text("recurrence"), // RFC5545 RRULE
  currentStreak: integer("current_streak").notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  completedAt: timestamp("completed_at", { mode: "string", withTimezone: true }),
  isArchived: boolean("is_archived").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});

export const taskDependencies = pgTable("task_dependencies", {
  taskId: uuid("task_id").notNull(),       // dependent task
  dependsOnId: uuid("depends_on_id").notNull(), // blocking task
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.taskId, t.dependsOnId] }),
}));

export const templates = pgTable("templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  bodyMd: text("body_md").notNull().default(""),
  profileId: uuid("profile_id"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).notNull().defaultNow(),
});

export const tasksRelations = relations(tasks, ({ many }) => ({
  dependencies: many(taskDependencies),
}));

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;
export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
