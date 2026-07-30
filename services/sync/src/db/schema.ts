import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-sync): define tables in schema sync_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const sync_meta = pgTable("sync_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
