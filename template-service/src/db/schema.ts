import { pgTable, uuid, varchar, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * Пример схемы — таблица пользователей.
 *
 * 🚧 Замените на реальную схему вашего сервиса.
 * См. drizzle-orm/pg-core для полного списка типов.
 */

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
