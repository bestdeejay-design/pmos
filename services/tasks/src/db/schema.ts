import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-tasks): define tables in schema tasks_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const tasks_meta = pgTable("tasks_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
