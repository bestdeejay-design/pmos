import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-profiles): define tables in schema profiles_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const profiles_meta = pgTable("profiles_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
