import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-settings): define tables in schema settings_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const settings_meta = pgTable("settings_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
