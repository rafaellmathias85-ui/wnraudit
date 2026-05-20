import type { Request, Response, NextFunction } from "express";

export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const customer = req.customer;
  if (!customer) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (customer.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
