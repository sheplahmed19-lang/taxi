import type { Prisma } from "@prisma/client";
import { prisma } from "../db/index.js";

/**
 * One append-only trail for manual admin actions on money-adjacent state
 * (payout decisions, owe adjustments, ...). See CLAUDE.md rule 3's spirit —
 * this isn't itself a ledger entry, but anything that changes a driver's
 * financial standing outside the normal trip/ledger flow should leave a
 * record of who did it and why.
 */
export async function logAudit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      targetType,
      targetId,
      meta: meta as unknown as Prisma.InputJsonValue | undefined,
    },
  });
}
