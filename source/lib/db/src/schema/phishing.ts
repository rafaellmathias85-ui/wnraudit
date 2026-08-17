import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgEnum,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { microsoftTenantsTable } from "./tenants";

export const phishingCampaignStatusEnum = pgEnum("phishing_campaign_status", [
  "draft",
  "active",
  "completed",
  "paused",
]);

export const phishingEventTypeEnum = pgEnum("phishing_event_type", [
  "sent",
  "opened",
  "clicked",
  "submitted",
  "reported",
]);

export const phishingCampaignsTable = pgTable("phishing_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").references(() => microsoftTenantsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  status: phishingCampaignStatusEnum("status").notNull().default("draft"),
  senderName: text("sender_name").notNull().default("Suporte TI"),
  senderEmail: text("sender_email").notNull(),
  authorizationNote: text("authorization_note"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const phishingTemplatesTable = pgTable("phishing_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => customersTable.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  category: text("category").notNull().default("other"),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const phishingEmployeesTable = pgTable("phishing_employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").references(() => microsoftTenantsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  department: text("department"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const phishingCampaignTargetsTable = pgTable("phishing_campaign_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => phishingCampaignsTable.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => phishingEmployeesTable.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => phishingTemplatesTable.id, {
    onDelete: "set null",
  }),
  trackingToken: uuid("tracking_token").notNull().defaultRandom(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const phishingEventsTable = pgTable("phishing_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetId: uuid("target_id")
    .notNull()
    .references(() => phishingCampaignTargetsTable.id, { onDelete: "cascade" }),
  eventType: phishingEventTypeEnum("event_type").notNull(),
  // true = ação confirmada de um humano real (interação genuína na página, e a
  // origem não é um scanner/IP de datacenter Microsoft nem rápida demais).
  // false = sinal detectado que pode ter sido gerado por scanner/Safe Links.
  humanVerified: boolean("human_verified").notNull().default(false),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata"),
});

export const phishingSmtpConfigsTable = pgTable("phishing_smtp_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpUser: text("smtp_user").notNull(),
  encryptedSmtpPass: text("encrypted_smtp_pass").notNull(),
  // pending | verified | failed
  status: text("status").notNull().default("pending"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PhishingSmtpConfig = typeof phishingSmtpConfigsTable.$inferSelect;

export type PhishingCampaign = typeof phishingCampaignsTable.$inferSelect;
export type InsertPhishingCampaign = typeof phishingCampaignsTable.$inferInsert;
export type PhishingTemplate = typeof phishingTemplatesTable.$inferSelect;
export type InsertPhishingTemplate = typeof phishingTemplatesTable.$inferInsert;
export type PhishingEmployee = typeof phishingEmployeesTable.$inferSelect;
export type InsertPhishingEmployee = typeof phishingEmployeesTable.$inferInsert;
export type PhishingCampaignTarget = typeof phishingCampaignTargetsTable.$inferSelect;
export type PhishingEvent = typeof phishingEventsTable.$inferSelect;
