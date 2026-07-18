import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { postEntry } from "../src/modules/wallet/ledger.js";
import { ConflictError, NotFoundError } from "../src/shared/errors.js";

const phone = "+201000088877";
let userId: string;
let walletId: string;

describe("wallet/ledger postEntry", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "rider", wallet: { create: { balance: 0 } } },
    });
    userId = user.id;
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    walletId = wallet.id;
  });

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { walletId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("credits a wallet and records the resulting balance", async () => {
    const { entry, created } = await postEntry({
      walletId,
      type: "topup",
      debit: 0,
      credit: 1000,
      idempotencyKey: `test:${phone}:credit1`,
    });
    expect(entry.balanceAfter).toBe(1000);
    expect(created).toBe(true);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.balance).toBe(1000);
  });

  it("debits a wallet", async () => {
    const { entry } = await postEntry({
      walletId,
      type: "ride_payment",
      debit: 300,
      credit: 0,
      idempotencyKey: `test:${phone}:debit1`,
    });
    expect(entry.balanceAfter).toBe(700);
  });

  it("is idempotent — replaying the same key returns the original entry without double-posting", async () => {
    const key = `test:${phone}:idempotent1`;
    const first = await postEntry({ walletId, type: "topup", debit: 0, credit: 200, idempotencyKey: key });
    const second = await postEntry({ walletId, type: "topup", debit: 0, credit: 200, idempotencyKey: key });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.entry.id).toBe(first.entry.id);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.balance).toBe(900); // 700 + 200, not + 400
  });

  it("rejects a debit that would take the balance negative", async () => {
    await expect(
      postEntry({
        walletId,
        type: "ride_payment",
        debit: 999999,
        credit: 0,
        idempotencyKey: `test:${phone}:overdraft`,
      }),
    ).rejects.toThrow(ConflictError);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.balance).toBe(900); // unchanged
  });

  it("throws NotFoundError for an unknown wallet", async () => {
    await expect(
      postEntry({
        walletId: "00000000-0000-0000-0000-000000000000",
        type: "topup",
        debit: 0,
        credit: 100,
        idempotencyKey: `test:${phone}:unknown-wallet`,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("never loses an update under concurrent postings to the same wallet", async () => {
    const before = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

    const concurrentCredits = Array.from({ length: 10 }, (_, i) =>
      postEntry({
        walletId,
        type: "topup",
        debit: 0,
        credit: 10,
        idempotencyKey: `test:${phone}:concurrent:${i}`,
      }),
    );
    await Promise.all(concurrentCredits);

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(after.balance).toBe(before.balance + 100); // 10 * 10, no lost updates
  });
});
