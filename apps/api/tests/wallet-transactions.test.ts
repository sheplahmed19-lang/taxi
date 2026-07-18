import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { getBalance, listTransactions } from "../src/modules/wallet/service.js";
import { postEntry } from "../src/modules/wallet/ledger.js";
import { NotFoundError } from "../src/shared/errors.js";

const phone = "+201000077712";
let userId: string;
let walletId: string;

describe("wallet/service getBalance + listTransactions", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "rider", wallet: { create: { balance: 0 } } },
    });
    userId = user.id;
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    walletId = wallet.id;

    // 25 entries so pagination has to span two pages (page size is 20).
    for (let i = 0; i < 25; i++) {
      await postEntry({
        walletId,
        type: "topup",
        debit: 0,
        credit: 10,
        idempotencyKey: `wallet-tx-test:${phone}:${i}`,
      });
    }
  });

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { walletId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("returns the wallet balance and currency", async () => {
    const balance = await getBalance(userId);
    expect(balance).toEqual({ balance: 250, currency: "EGP" });
  });

  it("throws NotFoundError for a user with no wallet", async () => {
    await expect(getBalance("00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);
  });

  it("lists the most recent transactions first, capped at a page of 20", async () => {
    const page1 = await listTransactions(userId);
    expect(page1).toHaveLength(20);
    expect(page1[0]!.idempotencyKey).toBe(`wallet-tx-test:${phone}:24`);

    const timestamps = page1.map((e) => e.createdAt.getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("pages forward with a cursor, with no overlap or gaps across all 25 entries", async () => {
    const page1 = await listTransactions(userId);
    const cursor = page1[page1.length - 1]!.id;
    const page2 = await listTransactions(userId, cursor);

    expect(page2).toHaveLength(5);
    const allIds = new Set([...page1, ...page2].map((e) => e.id));
    expect(allIds.size).toBe(25);
  });
});
