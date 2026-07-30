import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-calendar): define tables in schema calendar_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const calendar_meta = pgTable("calendar_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
