import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { severityEnum, findingStatusEnum } from "./findings";
import { scanStatusEnum } from "./scans";

export const deviceTypeEnum = pgEnum("device_type", [
  "firewall",
  "server",
  "external",
]);

export const firewallManufacturerEnum = pgEnum("firewall_manufacturer", [
  "cisco",
  "fortinet",
  "sophos",
  "ubiquiti",
  "tp-link",
  "pfsense",
  "checkpoint",
  "palo-alto",
  "meraki",
  "other",
]);

export const serverOsEnum = pgEnum("server_os", [
  "windows-server",
  "ubuntu",
  "debian",
  "rhel",
  "centos",
  "rocky-linux",
  "suse",
  "other",
]);

export const firewallDevicesTable = pgTable("firewall_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  manufacturer: firewallManufacturerEnum("manufacturer").notNull(),
  model: text("model"),
  ipAddress: text("ip_address"),
  firmwareVersion: text("firmware_version"),
  location: text("location"),
  notes: text("notes"),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type FirewallDevice = typeof firewallDevicesTable.$inferSelect;
export type InsertFirewallDevice = typeof firewallDevicesTable.$inferInsert;

export const serverDevicesTable = pgTable("server_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hostname: text("hostname").notNull(),
  os: serverOsEnum("os").notNull(),
  osVersion: text("os_version"),
  ipAddress: text("ip_address"),
  role: text("role"),
  notes: text("notes"),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ServerDevice = typeof serverDevicesTable.$inferSelect;
export type InsertServerDevice = typeof serverDevicesTable.$inferInsert;

export const deviceScansTable = pgTable("device_scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id").notNull(),
  deviceType: deviceTypeEnum("device_type").notNull(),
  status: scanStatusEnum("status").notNull().default("pending"),
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

export type DeviceScan = typeof deviceScansTable.$inferSelect;
export type InsertDeviceScan = typeof deviceScansTable.$inferInsert;

export const deviceFindingsTable = pgTable("device_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceScanId: uuid("device_scan_id")
    .notNull()
    .references(() => deviceScansTable.id, { onDelete: "cascade" }),
  controlId: text("control_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  severity: severityEnum("severity").notNull(),
  status: findingStatusEnum("status").notNull().default("open"),
  affectedResource: text("affected_resource"),
  description: text("description").notNull(),
  rationale: text("rationale").notNull(),
  remediation: text("remediation").notNull(),
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

export type DeviceFinding = typeof deviceFindingsTable.$inferSelect;
export type InsertDeviceFinding = typeof deviceFindingsTable.$inferInsert;

// ─── Probe (WNR Audit Security Probe) ────────────────────────────────────────

export const probeRegistrationsTable = pgTable("probe_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  // Token embarcado no script gerado — autenticação Bearer do probe
  probeToken: text("probe_token").notNull().unique(),
  // Preenchido pelo probe no primeiro checkin
  probeMachineId: text("probe_machine_id").unique(),
  displayName: text("display_name").notNull(),
  hostname: text("hostname"),
  ipAddress: text("ip_address"),
  os: text("os"),
  agentVersion: text("agent_version"),
  // pending | online | offline
  status: text("status").notNull().default("pending"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProbeRegistration = typeof probeRegistrationsTable.$inferSelect;

export const probeScanJobsTable = pgTable("probe_scan_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  probeId: uuid("probe_id")
    .notNull()
    .references(() => probeRegistrationsTable.id, { onDelete: "cascade" }),
  deviceScanId: uuid("device_scan_id")
    .notNull()
    .references(() => deviceScansTable.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull(),
  deviceType: deviceTypeEnum("device_type").notNull(),
  targetIp: text("target_ip").notNull(),
  targetHostname: text("target_hostname"),
  // queued | running | completed | failed
  status: text("status").notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type ProbeScanJob = typeof probeScanJobsTable.$inferSelect;
