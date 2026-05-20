import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";
import { scansTable } from "./scans";

export const severityEnum = pgEnum("severity", [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const findingStatusEnum = pgEnum("finding_status", [
  "open",
  "ignored",
  "resolved",
]);

export const findingsTable = pgTable("findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .references(() => scansTable.id, { onDelete: "cascade" }),
  controlId: text("control_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  severity: severityEnum("severity").notNull(),
  status: findingStatusEnum("status").notNull().default("open"),
  affectedResource: text("affected_resource"),
  description: text("description").notNull(),
  rationale: text("rationale").notNull(),
  remediation: text("remediation").notNull(),
  configPath: text("config_path"),
  references: jsonb("references").$type<string[]>().notNull().default([]),
  evidence: jsonb("evidence").$type<Record<string, unknown> | null>(),
  note: text("note"),
  detectedAt: timestamp("detected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Finding = typeof findingsTable.$inferSelect;
export type InsertFinding = typeof findingsTable.$inferInsert;
