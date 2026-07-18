import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { adjustOwe, getOwe, listOweReport, payOweFromWallet } from "../src/modules/wallet/service.js";
import { ConflictError } from "../src/shared/errors.js";

const phone = "+201000077822";
let driverId: string;

describe("owe management", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "driver", wallet: { create: { balance: 300 } } },
    });
    driverId = user.id;
    // OweAmount.driverId FKs to DriverProfile.userId, not User.id directly.
    await prisma.driverProfile.upsert({ where: { userId: driverId }, update: {}, create: { userId: driverId } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetType: "owe_amount", targetId: driverId } });
    await prisma.oweAmount.deleteMany({ where: { driverId } });
    await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId: driverId } } });
    await prisma.driverProfile.deleteMany({ where: { userId: driverId } });
    await prisma.wallet.deleteMany({ where: { userId: driverId } });
    await prisma.user.delete({ where: { id: driverId } });
    await prisma.$disconnect();
  });

  it("getOwe returns 0 for a driver with no owe row", async () => {
    expect(await getOwe(driverId)).toEqual({ amount: 0 });
  });

  it("payOweFromWallet rejects when nothing is owed", async () => {
    await expect(payOweFromWallet(driverId)).rejects.toThrow(ConflictError);
  });

  it("payOweFromWallet rejects an insufficient wallet balance, leaving owe untouched", async () => {
    await prisma.oweAmount.create({ data: { driverId, amount: 999999 } });
    await expect(payOweFromWallet(driverId)).rejects.toThrow(ConflictError);

    const owe = await getOwe(driverId);
    expect(owe.amount).toBe(999999);

    await prisma.oweAmount.update({ where: { driverId }, data: { amount: 0 } });
  });

  it("payOweFromWallet debits the wallet and zeroes the owe when funds are sufficient", async () => {
    await prisma.oweAmount.upsert({ where: { driverId }, update: { amount: 200 }, create: { driverId, amount: 200 } });
    const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverId } });

    await payOweFromWallet(driverId);

    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverId } });
    expect(after.balance).toBe(before.balance - 200);
    expect(await getOwe(driverId)).toEqual({ amount: 0 });
  });

  it("adjustOwe increments, decrements (clamped at 0), and records an audit entry each time", async () => {
    await adjustOwe(driverId, 150, "manual charge", "admin-1");
    expect(await getOwe(driverId)).toEqual({ amount: 150 });

    await adjustOwe(driverId, -500, "forgiveness", "admin-1");
    expect(await getOwe(driverId)).toEqual({ amount: 0 }); // clamped, never negative

    const audits = await prisma.auditLog.findMany({ where: { targetType: "owe_amount", targetId: driverId }, orderBy: { createdAt: "asc" } });
    expect(audits).toHaveLength(2);
    expect(audits[0]!.action).toBe("owe.adjust");
    expect((audits[0]!.meta as { reason: string }).reason).toBe("manual charge");
  });

  it("listOweReport only includes drivers with a positive balance", async () => {
    await adjustOwe(driverId, 75, "test report entry", "admin-1");
    const report = await listOweReport();
    expect(report.some((r) => r.driverId === driverId)).toBe(true);
    expect(report.every((r) => r.amount > 0)).toBe(true);
  });
});
