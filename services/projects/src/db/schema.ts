import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-projects): define tables in schema projects_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const projects_meta = pgTable("projects_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
