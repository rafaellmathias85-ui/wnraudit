import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

export async function ensureSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "tenant_inquiries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
        "tenant_id" uuid NOT NULL REFERENCES "microsoft_tenants"("id") ON DELETE CASCADE,
        "question" text NOT NULL,
        "answer" text NOT NULL,
        "service_detected" text,
        "license_summary" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);

    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
          CREATE TYPE user_status AS ENUM ('pending','active','blocked');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
          CREATE TYPE user_role AS ENUM ('super_admin','user');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'external_asset_kind') THEN
          CREATE TYPE external_asset_kind AS ENUM ('firewall','server','web','api','other');
        END IF;
      END $$;
    `);

    await db.execute(sql`
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "full_name" text;
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "status" user_status NOT NULL DEFAULT 'pending';
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "role" user_role NOT NULL DEFAULT 'user';
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "approved_by_id" uuid;
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
    `);

    // Promote any pre-existing super-admin email accounts so they don't get locked out
    await db.execute(sql`
      UPDATE "customers"
      SET role = 'super_admin', status = 'active', approved_at = COALESCE(approved_at, now())
      WHERE LOWER(email) IN ('rafaellmathias85@gmail.com', 'rafael@wticorp.com.br')
        AND (role <> 'super_admin' OR status <> 'active');
    `);

    // One-shot migration of historical accounts that existed before approval
    // gating: only ativa contas criadas estritamente antes da introdução desta
    // coluna (timestamp fixo). Rodadas posteriores não afetam novos cadastros.
    await db.execute(sql`
      UPDATE "customers"
      SET status = 'active', approved_at = COALESCE(approved_at, now())
      WHERE status = 'pending'
        AND created_at < timestamp with time zone '2026-04-29 00:00:00+00';
    `);

    // Indice case-insensitive em e-mail para reconciliação convite ↔ login
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "customers_email_lower_idx"
        ON "customers" (LOWER(email));
    `);

    await db.execute(sql`
      ALTER TYPE "device_type" ADD VALUE IF NOT EXISTS 'external';
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "external_assets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "kind" external_asset_kind NOT NULL DEFAULT 'other',
        "host" text NOT NULL,
        "port" integer,
        "notes" text,
        "last_scan_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);

    logger.info("Schema bootstrap: OK");
  } catch (err) {
    logger.error({ err }, "Schema bootstrap failed");
    throw err;
  }
}
