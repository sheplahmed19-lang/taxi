import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError, ForbiddenError } from "../shared/errors.js";

export interface AuthUser {
  id: string;
  role: "rider" | "driver" | "staff" | "admin" | "fleet_owner" | "dispatcher";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Placeholder JWT auth middleware. Real verification lands in Phase 0.3 (auth module).
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }
  next();
}

export function requireRole(...roles: AuthUser["role"][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenError("Insufficient role");
    }
    next();
  };
}
