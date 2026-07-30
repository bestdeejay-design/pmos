import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-files): define tables in schema files_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const files_meta = pgTable("files_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
