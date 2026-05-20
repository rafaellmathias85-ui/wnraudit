import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  integer,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const externalAssetKindEnum = pgEnum("external_asset_kind", [
  "firewall",
  "server",
  "web",
  "api",
  "other",
]);

export const externalAssetsTable = pgTable("external_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: externalAssetKindEnum("kind").notNull().default("other"),
  host: text("host").notNull(),
  port: integer("port"),
  notes: text("notes"),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ExternalAsset = typeof externalAssetsTable.$inferSelect;
export type InsertExternalAsset = typeof externalAssetsTable.$inferInsert;
