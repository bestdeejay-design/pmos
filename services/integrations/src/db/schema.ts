import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-integrations): define tables in schema integrations_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const integrations_meta = pgTable("integrations_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
