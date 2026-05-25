import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

export async function ensureSchema(): Promise<void> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
          CREATE TYPE user_status AS ENUM ('pending','active','blocked');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
          CREATE TYPE user_role AS ENUM ('super_admin','user');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_status') THEN
          CREATE TYPE tenant_status AS ENUM ('pending','connected','error','disconnected');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cloud_scope') THEN
          CREATE TYPE cloud_scope AS ENUM ('m365','azure','both');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scan_status') THEN
          CREATE TYPE scan_status AS ENUM ('pending','running','completed','failed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scan_mode') THEN
          CREATE TYPE scan_mode AS ENUM ('simple','advanced');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'severity') THEN
          CREATE TYPE severity AS ENUM ('critical','high','medium','low','info');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finding_status') THEN
          CREATE TYPE finding_status AS ENUM ('open','ignored','resolved');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_type') THEN
          CREATE TYPE device_type AS ENUM ('firewall','server','external');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'external_asset_kind') THEN
          CREATE TYPE external_asset_kind AS ENUM ('firewall','server','web','api','other');
        END IF;
      END $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "customers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "clerk_user_id" text NOT NULL UNIQUE,
        "email" text NOT NULL,
        "full_name" text,
        "organization_name" text,
        "status" user_status NOT NULL DEFAULT 'pending',
        "role" user_role NOT NULL DEFAULT 'user',
        "approved_at" timestamp with time zone,
        "approved_by_id" uuid,
        "last_login_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);

    await db.execute(sql`
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "full_name" text;
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "organization_name" text;
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "status" user_status NOT NULL DEFAULT 'pending';
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "role" user_role NOT NULL DEFAULT 'user';
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "approved_by_id" uuid;
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
      ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
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
      CREATE TABLE IF NOT EXISTS "microsoft_tenants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
        "microsoft_tenant_id" text NOT NULL,
        "display_name" text NOT NULL,
        "primary_domain" text,
        "scope" cloud_scope NOT NULL DEFAULT 'm365',
        "status" tenant_status NOT NULL DEFAULT 'pending',
        "encrypted_refresh_token" text,
        "consent_state" text,
        "last_error_message" text,
        "provisioned_app_id" text,
        "provisioned_app_object_id" text,
        "encrypted_client_secret" text,
        "device_code_flow_json" text,
        "provisioning_status" text DEFAULT 'idle',
        "last_scan_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "scans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_id" uuid NOT NULL REFERENCES "microsoft_tenants"("id") ON DELETE CASCADE,
        "status" scan_status NOT NULL DEFAULT 'pending',
        "scan_mode" scan_mode NOT NULL DEFAULT 'simple',
        "started_at" timestamp with time zone DEFAULT now() NOT NULL,
        "completed_at" timestamp with time zone,
        "total_checks" integer NOT NULL DEFAULT 0,
        "passed_checks" integer NOT NULL DEFAULT 0,
        "failed_checks" integer NOT NULL DEFAULT 0,
        "critical_count" integer NOT NULL DEFAULT 0,
        "high_count" integer NOT NULL DEFAULT 0,
        "medium_count" integer NOT NULL DEFAULT 0,
        "low_count" integer NOT NULL DEFAULT 0
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "findings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "scan_id" uuid NOT NULL REFERENCES "scans"("id") ON DELETE CASCADE,
        "control_id" text NOT NULL,
        "title" text NOT NULL,
        "category" text NOT NULL,
        "severity" severity NOT NULL,
        "status" finding_status NOT NULL DEFAULT 'open',
        "affected_resource" text,
        "description" text NOT NULL,
        "rationale" text NOT NULL,
        "remediation" text NOT NULL,
        "config_path" text,
        "references" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "evidence" jsonb,
        "note" text,
        "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `);

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
