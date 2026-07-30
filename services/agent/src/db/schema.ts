import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-agent): define tables in schema agent_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const agent_meta = pgTable("agent_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
