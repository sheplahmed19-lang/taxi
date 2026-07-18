import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { approvePayout, listMyPayouts, listPayouts, markPayoutPaid, rejectPayout, requestPayout } from "../src/modules/payouts/service.js";
import { ConflictError, NotFoundError } from "../src/shared/errors.js";

const phone = "+201000077821";
let driverId: string;

describe("payouts", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "driver", wallet: { create: { balance: 10000 } } },
    });
    driverId = user.id;
    // Payout.driverId FKs to DriverProfile.userId, not User.id directly.
    await prisma.driverProfile.upsert({ where: { userId: driverId }, update: {}, create: { userId: driverId } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetType: "payout" } });
    await prisma.payout.deleteMany({ where: { driverId } });
    await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId: driverId } } });
    await prisma.driverProfile.deleteMany({ where: { userId: driverId } });
    await prisma.wallet.deleteMany({ where: { userId: driverId } });
    await prisma.user.delete({ where: { id: driverId } });
    await prisma.$disconnect();
  });

  it("reserves the amount out of the wallet immediately on request", async () => {
    const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverId } });
    const payout = await requestPayout(driverId, 2000);
    expect(payout.status).toBe("requested");

    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverId } });
    expect(after.balance).toBe(before.balance - 2000);
  });

  it("rejects a request exceeding the wallet balance, without creating a payout row", async () => {
    await expect(requestPayout(driverId, 999999)).rejects.toThrow(ConflictError);
    const payouts = await listMyPayouts(driverId);
    expect(payouts.every((p) => p.amount !== 999999)).toBe(true);
  });

  it("full lifecycle: request -> approve -> mark paid, with an audit trail", async () => {
    const payout = await requestPayout(driverId, 1000);

    await expect(markPayoutPaid(payout.id, "admin-1", "bank_transfer")).rejects.toThrow(ConflictError); // not approved yet

    const approved = await approvePayout(payout.id, "admin-1");
    expect(approved.status).toBe("approved");
    expect(approved.processedBy).toBe("admin-1");

    const paid = await markPayoutPaid(payout.id, "admin-1", "bank_transfer");
    expect(paid.status).toBe("paid");
    expect(paid.method).toBe("bank_transfer");

    const audits = await prisma.auditLog.findMany({ where: { targetType: "payout", targetId: payout.id } });
    expect(audits.map((a) => a.action).sort()).toEqual(["payout.approve", "payout.mark_paid"]);
  });

  it("reject refunds the reserved amount back to the wallet and records why", async () => {
    const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverId } });
    const payout = await requestPayout(driverId, 500);

    const afterRequest = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverId } });
    expect(afterRequest.balance).toBe(before.balance - 500);

    const rejected = await rejectPayout(payout.id, "admin-1", "Bank details invalid");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Bank details invalid");

    const afterReject = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverId } });
    expect(afterReject.balance).toBe(before.balance); // fully refunded

    await expect(approvePayout(payout.id, "admin-1")).rejects.toThrow(ConflictError); // terminal state
  });

  it("404s on an unknown payout id", async () => {
    await expect(approvePayout("00000000-0000-0000-0000-000000000000", "admin-1")).rejects.toThrow(NotFoundError);
  });

  it("listPayouts filters by status; listMyPayouts scopes to the driver", async () => {
    const requested = await listPayouts("requested");
    expect(requested.every((p) => p.status === "requested")).toBe(true);

    const mine = await listMyPayouts(driverId);
    expect(mine.every((p) => p.driverId === driverId)).toBe(true);
  });
});
