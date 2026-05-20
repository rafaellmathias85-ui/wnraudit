import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";
import { logger } from "../lib/logger";

async function fetchClerkProfile(
  clerkUserId: string,
): Promise<{ email: string | null; name: string | null }> {
  try {
    const u = await clerkClient.users.getUser(clerkUserId);
    const primaryId = u.primaryEmailAddressId;
    const primary =
      u.emailAddresses.find((e) => e.id === primaryId) ?? u.emailAddresses[0];
    const email = primary?.emailAddress?.trim().toLowerCase() ?? null;
    const name =
      [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null;
    return { email, name };
  } catch (err) {
    logger.warn({ err, clerkUserId }, "Failed to fetch Clerk user profile");
    return { email: null, name: null };
  }
}

export const SUPER_ADMIN_EMAILS = [
  "rafaellmathias85@gmail.com",
  "rafael@wticorp.com.br",
];

function isSuperAdminEmail(email: string): boolean {
  return SUPER_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

const PENDING_ALLOWLIST: ReadonlyArray<RegExp> = [
  /^\/me$/,
  /^\/healthz$/,
];

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId =
    (auth?.sessionClaims?.userId as string | undefined) || auth?.userId;

  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const claims = auth?.sessionClaims as Record<string, unknown> | undefined;
  let claimEmail =
    (claims?.["email"] as string | undefined) ??
    (claims?.["primary_email_address"] as string | undefined) ??
    (claims?.["primaryEmailAddress"] as string | undefined) ??
    null;
  let claimName =
    (claims?.["name"] as string | undefined) ??
    (claims?.["full_name"] as string | undefined) ??
    null;

  const [existing] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.clerkUserId, clerkUserId))
    .limit(1);

  let customer = existing;

  // Se a sessão JWT do Clerk não traz o e-mail (padrão), buscamos via API
  // server-to-server. Também repuxamos quando o registro existente está com
  // e-mail sintético "@unknown.local" para auto-corrigir contas antigas.
  const needProfileFetch =
    !claimEmail ||
    (existing?.email?.endsWith("@unknown.local") ?? false);
  if (needProfileFetch) {
    const profile = await fetchClerkProfile(clerkUserId);
    if (profile.email) claimEmail = profile.email;
    if (!claimName && profile.name) claimName = profile.name;
  }

  if (!customer) {
    const email =
      claimEmail?.trim().toLowerCase() ?? `${clerkUserId}@unknown.local`;
    const promote = isSuperAdminEmail(email);

    // Reconciliação: se existe um registro de convite (clerkUserId começando
    // com "invited:") ou qualquer registro órfão para este e-mail, claim ele.
    const [byEmail] = await db
      .select()
      .from(customersTable)
      .where(sql`LOWER(${customersTable.email}) = ${email}`)
      .limit(1);

    if (byEmail) {
      const updates: Partial<typeof customersTable.$inferInsert> = {
        clerkUserId,
        lastLoginAt: new Date(),
      };
      if (claimName && byEmail.fullName !== claimName) updates.fullName = claimName;
      if (promote) {
        updates.role = "super_admin";
        updates.status = "active";
        if (!byEmail.approvedAt) updates.approvedAt = new Date();
      }
      const [claimed] = await db
        .update(customersTable)
        .set(updates)
        .where(eq(customersTable.id, byEmail.id))
        .returning();
      customer = claimed;
    } else {
      const [created] = await db
        .insert(customersTable)
        .values({
          clerkUserId,
          email,
          fullName: claimName,
          status: promote ? "active" : "pending",
          role: promote ? "super_admin" : "user",
          approvedAt: promote ? new Date() : null,
          lastLoginAt: new Date(),
        })
        .returning();
      customer = created;
    }
  } else {
    // Self-promote if the super admin email logs in but is missing the role
    // (covers data migrated before this feature existed).
    let needsUpdate = false;
    const updates: Partial<typeof customersTable.$inferInsert> = {
      lastLoginAt: new Date(),
    };
    // Auto-corrige e-mail sintético antigo quando o real está disponível
    if (
      claimEmail &&
      customer.email.toLowerCase() !== claimEmail.toLowerCase()
    ) {
      updates.email = claimEmail;
      needsUpdate = true;
    }
    const effectiveEmail = claimEmail ?? customer.email;
    if (
      isSuperAdminEmail(effectiveEmail) &&
      (customer.role !== "super_admin" || customer.status !== "active")
    ) {
      updates.role = "super_admin";
      updates.status = "active";
      if (!customer.approvedAt) updates.approvedAt = new Date();
      needsUpdate = true;
    }
    if (claimName && customer.fullName !== claimName) {
      updates.fullName = claimName;
      needsUpdate = true;
    }
    if (needsUpdate || !customer.lastLoginAt) {
      const [updated] = await db
        .update(customersTable)
        .set(updates)
        .where(eq(customersTable.id, customer.id))
        .returning();
      if (updated) customer = updated;
    }
  }

  req.customer = customer;

  if (customer.status !== "active") {
    const path = req.path;
    const allowed = PENDING_ALLOWLIST.some((rx) => rx.test(path));
    if (!allowed) {
      res.status(403).json({
        error: "PendingApproval",
        status: customer.status,
      });
      return;
    }
  }

  next();
}
