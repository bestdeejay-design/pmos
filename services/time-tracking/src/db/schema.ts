import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-time-tracking): define tables in schema time_tracking_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const time_tracking_meta = pgTable("time_tracking_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
