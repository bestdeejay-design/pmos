import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-export-import): define tables in schema export_import_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const export_import_meta = pgTable("export_import_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
