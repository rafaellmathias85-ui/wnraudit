import type { Customer } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      customer?: Customer;
    }
  }
}

export {};
