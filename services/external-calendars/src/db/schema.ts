import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-external-calendars): define tables in schema external_calendars_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const external_calendars_meta = pgTable("external_calendars_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
