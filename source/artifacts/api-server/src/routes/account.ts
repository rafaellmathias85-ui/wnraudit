import { Router, type IRouter } from "express";
import { schemas } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/me", requireAuth, async (req, res): Promise<void> => {
  const customer = req.customer!;
  const data = schemas.GetMeResponse.parse({
    id: customer.id,
    clerkUserId: customer.clerkUserId,
    email: customer.email,
    organizationName: customer.organizationName ?? null,
    fullName: customer.fullName ?? null,
    status: customer.status,
    role: customer.role,
    createdAt: customer.createdAt,
  });
  res.json(data);
});

export default router;
