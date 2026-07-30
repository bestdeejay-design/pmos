import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-notes): define tables in schema notes_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const notes_meta = pgTable("notes_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
