import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { microsoftTenantsTable } from "./tenants";

export const tenantInquiriesTable = pgTable("tenant_inquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => microsoftTenantsTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  serviceDetected: text("service_detected"),
  licenseSummary: jsonb("license_summary"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TenantInquiry = typeof tenantInquiriesTable.$inferSelect;
export type InsertTenantInquiry = typeof tenantInquiriesTable.$inferInsert;
