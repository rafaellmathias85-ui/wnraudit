import {
  pgTable,
  uuid,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { microsoftTenantsTable } from "./tenants";

export const scanStatusEnum = pgEnum("scan_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const scanModeEnum = pgEnum("scan_mode", ["simple", "advanced"]);

export const scansTable = pgTable("scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => microsoftTenantsTable.id, { onDelete: "cascade" }),
  status: scanStatusEnum("status").notNull().default("pending"),
  scanMode: scanModeEnum("scan_mode").notNull().default("simple"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalChecks: integer("total_checks").notNull().default(0),
  passedChecks: integer("passed_checks").notNull().default(0),
  failedChecks: integer("failed_checks").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  highCount: integer("high_count").notNull().default(0),
  mediumCount: integer("medium_count").notNull().default(0),
  lowCount: integer("low_count").notNull().default(0),
});

export type Scan = typeof scansTable.$inferSelect;
export type InsertScan = typeof scansTable.$inferInsert;
