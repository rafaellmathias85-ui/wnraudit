import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const tenantStatusEnum = pgEnum("tenant_status", [
  "pending",
  "connected",
  "error",
  "disconnected",
]);

export const cloudScopeEnum = pgEnum("cloud_scope", ["m365", "azure", "both"]);

export const microsoftTenantsTable = pgTable("microsoft_tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  microsoftTenantId: text("microsoft_tenant_id").notNull(),
  displayName: text("display_name").notNull(),
  primaryDomain: text("primary_domain"),
  scope: cloudScopeEnum("scope").notNull().default("m365"),
  status: tenantStatusEnum("status").notNull().default("pending"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  consentState: text("consent_state"),
  lastErrorMessage: text("last_error_message"),
  provisionedAppId: text("provisioned_app_id"),
  provisionedAppObjectId: text("provisioned_app_object_id"),
  encryptedClientSecret: text("encrypted_client_secret"),
  deviceCodeFlowJson: text("device_code_flow_json"),
  provisioningStatus: text("provisioning_status").default("idle"),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MicrosoftTenant = typeof microsoftTenantsTable.$inferSelect;
export type InsertMicrosoftTenant = typeof microsoftTenantsTable.$inferInsert;
