import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { phishingEmployeesTable } from "./phishing";

export const awarenessModulesTable = pgTable("awareness_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  contentMarkdown: text("content_markdown").notNull(),
  moduleType: text("module_type").notNull().default("article"),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  videoUrl: text("video_url"),
  quizQuestions: jsonb("quiz_questions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const awarenessCompletionsTable = pgTable("awareness_completions", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => phishingEmployeesTable.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id")
    .notNull()
    .references(() => awarenessModulesTable.id, { onDelete: "cascade" }),
  score: integer("score"),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AwarenessModule = typeof awarenessModulesTable.$inferSelect;
export type InsertAwarenessModule = typeof awarenessModulesTable.$inferInsert;
export type AwarenessCompletion = typeof awarenessCompletionsTable.$inferSelect;
