import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-ai-gateway): define tables in schema ai_gateway_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const ai_gateway_meta = pgTable("ai_gateway_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
