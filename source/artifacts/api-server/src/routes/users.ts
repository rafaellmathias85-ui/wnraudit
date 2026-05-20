import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";

const router: IRouter = Router();

function serialize(c: typeof customersTable.$inferSelect) {
  return {
    id: c.id,
    email: c.email,
    fullName: c.fullName ?? null,
    organizationName: c.organizationName ?? null,
    status: c.status,
    role: c.role,
    approvedAt: c.approvedAt ?? null,
    lastLoginAt: c.lastLoginAt ?? null,
    createdAt: c.createdAt,
  };
}

router.get(
  "/users",
  requireAuth,
  requireSuperAdmin,
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(customersTable)
      .orderBy(desc(customersTable.createdAt));
    res.json(schemas.ListUsersResponse.parse(rows.map(serialize)));
  },
);

router.post(
  "/users/invite",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const parsed = schemas.InviteUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();

    const [existing] = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.email, email))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Já existe usuário com esse e-mail." });
      return;
    }

    const [created] = await db
      .insert(customersTable)
      .values({
        clerkUserId: `invited:${email}`,
        email,
        fullName: parsed.data.fullName ?? null,
        status: "pending",
        role: "user",
      })
      .returning();

    res.status(201).json(schemas.ListUsersResponseItem.parse(serialize(created)));
  },
);

router.post(
  "/users/:userId/approve",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const userId = req.params.userId as string;
    const approver = req.customer!;
    const [updated] = await db
      .update(customersTable)
      .set({
        status: "active",
        approvedAt: new Date(),
        approvedById: approver.id,
        updatedAt: new Date(),
      })
      .where(eq(customersTable.id, userId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    res.json(schemas.ApproveUserResponse.parse(serialize(updated)));
  },
);

router.post(
  "/users/:userId/block",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const userId = req.params.userId as string;
    const [updated] = await db
      .update(customersTable)
      .set({ status: "blocked", updatedAt: new Date() })
      .where(eq(customersTable.id, userId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    res.json(schemas.BlockUserResponse.parse(serialize(updated)));
  },
);

router.delete(
  "/users/:userId",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const userId = req.params.userId as string;
    const requester = req.customer!;
    if (userId === requester.id) {
      res
        .status(400)
        .json({ error: "Não é possível excluir a própria conta." });
      return;
    }
    const [deleted] = await db
      .delete(customersTable)
      .where(eq(customersTable.id, userId))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;
