import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { getDriverDocuments } from "../src/modules/admin/service.js";
import { NotFoundError } from "../src/shared/errors.js";

const suffix = Date.now();
const userIds: string[] = [];

describe("admin driver document viewer", () => {
  afterAll(async () => {
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("returns a signed URL per uploaded document", async () => {
    const driver = await prisma.user.create({
      data: { phone: `+2010011${suffix}`, role: "driver", wallet: { create: { balance: 0 } } },
    });
    userIds.push(driver.id);
    await prisma.driverProfile.create({
      data: {
        userId: driver.id,
        verificationStatus: "pending",
        documents: { license: "driver-documents/abc/license.jpg", id_card: "driver-documents/abc/id.jpg" },
      },
    });

    const documents = await getDriverDocuments(driver.id);
    expect(documents).toHaveLength(2);
    const types = documents.map((d) => d.type).sort();
    expect(types).toEqual(["id_card", "license"]);
    for (const doc of documents) {
      expect(doc.url).toMatch(/^https?:\/\//);
    }
  });

  it("returns an empty list when no documents were uploaded yet", async () => {
    const driver = await prisma.user.create({
      data: { phone: `+2010012${suffix}`, role: "driver", wallet: { create: { balance: 0 } } },
    });
    userIds.push(driver.id);
    await prisma.driverProfile.create({ data: { userId: driver.id, verificationStatus: "pending" } });

    const documents = await getDriverDocuments(driver.id);
    expect(documents).toEqual([]);
  });

  it("404s for a user with no driver profile", async () => {
    const rider = await prisma.user.create({ data: { phone: `+2010013${suffix}`, role: "rider" } });
    userIds.push(rider.id);

    await expect(getDriverDocuments(rider.id)).rejects.toThrow(NotFoundError);
  });
});
