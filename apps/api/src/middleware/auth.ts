import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError, ForbiddenError } from "../shared/errors.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";
import { userHasPermission } from "../modules/admin/service.js";

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

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }

  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    req.user = { id: payload.id, role: payload.role };
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
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

/** Fine-grained RBAC check for staff/admin panels, on top of requireRole. */
export function requirePermission(permissionKey: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      throw new ForbiddenError("Not authenticated");
    }
    const allowed = await userHasPermission(req.user.id, permissionKey);
    if (!allowed) {
      throw new ForbiddenError(`Missing permission: ${permissionKey}`);
    }
    next();
  };
}
