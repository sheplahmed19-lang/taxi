import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { listStatementsForAdmin } from "../src/modules/drivers/service.js";

const userIds: string[] = [];
const statementIds: string[] = [];
const suffix = Date.now();

async function makeDriverWithStatement(phone: string, name: string) {
  const user = await prisma.user.create({ data: { phone, role: "driver", name, wallet: { create: { balance: 0 } } } });
  await prisma.driverProfile.create({ data: { userId: user.id, verificationStatus: "approved" } });
  const statement = await prisma.driverStatement.create({
    data: {
      driverId: user.id,
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-01-08"),
      objectKey: `statements/${user.id}/test.csv`,
      tripCount: 3,
      totalEarnings: 5000,
      totalCommission: 1000,
    },
  });
  userIds.push(user.id);
  statementIds.push(statement.id);
  return { user, statement };
}

describe("admin statements view", () => {
  afterAll(async () => {
    await prisma.driverStatement.deleteMany({ where: { id: { in: statementIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("lists statements across all drivers with a signed download URL and driver identity", async () => {
    const { user } = await makeDriverWithStatement(`+2010012${suffix}`, "Statement Driver A");

    const all = await listStatementsForAdmin();
    const found = all.find((s) => s.driverId === user.id);
    expect(found).toBeDefined();
    expect(found?.downloadUrl).toMatch(/^https?:\/\//);
    expect(found?.driver.user.name).toBe("Statement Driver A");
  });

  it("filters to a single driver when driverId is passed", async () => {
    const { user: driverA } = await makeDriverWithStatement(`+2010013${suffix}`, "Statement Driver B");
    const { user: driverB } = await makeDriverWithStatement(`+2010014${suffix}`, "Statement Driver C");

    const onlyA = await listStatementsForAdmin(driverA.id);
    expect(onlyA.every((s) => s.driverId === driverA.id)).toBe(true);
    expect(onlyA.some((s) => s.driverId === driverB.id)).toBe(false);
  });
});
