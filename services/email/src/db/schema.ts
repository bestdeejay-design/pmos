import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-email): define tables in schema email_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const email_meta = pgTable("email_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
