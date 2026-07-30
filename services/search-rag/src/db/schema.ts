import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

// TODO(svc-search-rag): define tables in schema search_rag_ per ADR-004 + contracts.
// Example stub — replace with real columns from FEATURES.md:
export const search_rag_meta = pgTable("search_rag_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
