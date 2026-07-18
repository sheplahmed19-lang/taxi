import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { createPromo, deletePromo, listPromos, previewPromo, updatePromo } from "../src/modules/promos/service.js";
import { ConflictError, NotFoundError } from "../src/shared/errors.js";

// Inside the seed script's "Test Zone — Downtown" polygon (see fares-service.test.ts).
const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let riderId: string;
let vehicleTypeId: string;
const promoCodes: string[] = [];

async function makePromo(overrides: Partial<Parameters<typeof createPromo>[0]> = {}) {
  const code = `PROMO${Date.now()}${Math.floor(Math.random() * 100000)}`;
  promoCodes.push(code);
  return createPromo({
    code,
    type: "flat",
    value: 200,
    vehicleTypeIds: [],
    zoneIds: [],
    active: true,
    ...overrides,
  });
}

describe("promos", () => {
  afterAll(async () => {
    await prisma.promoRedemption.deleteMany({ where: { promo: { code: { in: promoCodes } } } });
    await prisma.promoCode.deleteMany({ where: { code: { in: promoCodes } } });
    await prisma.vehicleType.deleteMany({ where: { id: vehicleTypeId } });
    await prisma.user.deleteMany({ where: { id: riderId } });
    await prisma.$disconnect();
  });

  it("sets up a rider and a dedicated vehicle type", async () => {
    const user = await prisma.user.upsert({
      where: { phone: "+201000088801" },
      update: {},
      create: { phone: "+201000088801", role: "rider" },
    });
    riderId = user.id;

    const vt = await prisma.vehicleType.create({
      data: {
        name: `PromoTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;
  });

  it("previewPromo applies a flat discount", async () => {
    const promo = await makePromo({ type: "flat", value: 200 });
    const preview = await previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId);
    expect(preview.promoDiscount).toBe(200);
    expect(preview.total).toBe(preview.preDiscountTotal - 200);
  });

  it("previewPromo applies a percent discount capped at maxDiscount", async () => {
    const promo = await makePromo({ type: "percent", value: 90, maxDiscount: 50 });
    const preview = await previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId);
    expect(preview.promoDiscount).toBe(50);
  });

  it("rejects an unknown code", async () => {
    await expect(previewPromo(riderId, "DOES-NOT-EXIST", pickup, drop, vehicleTypeId)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("rejects an inactive promo", async () => {
    const promo = await makePromo({ active: false });
    await expect(previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId)).rejects.toThrow(NotFoundError);
  });

  it("rejects a promo that hasn't started yet", async () => {
    const promo = await makePromo({ validFrom: new Date(Date.now() + 86_400_000) });
    await expect(previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId)).rejects.toThrow(ConflictError);
  });

  it("rejects an expired promo", async () => {
    const promo = await makePromo({ validUntil: new Date(Date.now() - 86_400_000) });
    await expect(previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId)).rejects.toThrow(ConflictError);
  });

  it("rejects when the fare is below the promo's minimum", async () => {
    const promo = await makePromo({ minFare: 999_999 });
    await expect(previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId)).rejects.toThrow(ConflictError);
  });

  it("rejects a vehicle type not on the promo's allow-list", async () => {
    const promo = await makePromo({ vehicleTypeIds: ["00000000-0000-0000-0000-000000000000"] });
    await expect(previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId)).rejects.toThrow(ConflictError);
  });

  it("rejects a pickup zone not on the promo's allow-list", async () => {
    const promo = await makePromo({ zoneIds: ["00000000-0000-0000-0000-000000000000"] });
    await expect(previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId)).rejects.toThrow(ConflictError);
  });

  it("rejects once the overall usage limit is reached", async () => {
    const promo = await makePromo({ usageLimit: 1 });
    await prisma.promoRedemption.create({ data: { promoId: promo.id, userId: riderId } });
    await expect(previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId)).rejects.toThrow(ConflictError);
  });

  it("rejects once this rider's per-user limit is reached", async () => {
    const promo = await makePromo({ perUserLimit: 1 });
    await prisma.promoRedemption.create({ data: { promoId: promo.id, userId: riderId } });
    await expect(previewPromo(riderId, promo.code, pickup, drop, vehicleTypeId)).rejects.toThrow(ConflictError);

    // A different rider hasn't touched their per-user limit yet.
    const other = await prisma.user.upsert({
      where: { phone: "+201000088802" },
      update: {},
      create: { phone: "+201000088802", role: "rider" },
    });
    const preview = await previewPromo(other.id, promo.code, pickup, drop, vehicleTypeId);
    expect(preview.promoDiscount).toBe(200);
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("admin CRUD: create, list, update, and delete (blocked once redeemed)", async () => {
    const promo = await makePromo({ value: 300 });
    const listed = await listPromos();
    expect(listed.some((p) => p.id === promo.id)).toBe(true);

    const updated = await updatePromo(promo.id, { active: false });
    expect(updated.active).toBe(false);

    await expect(updatePromo("00000000-0000-0000-0000-000000000000", { active: false })).rejects.toThrow(
      NotFoundError,
    );

    await prisma.promoRedemption.create({ data: { promoId: promo.id, userId: riderId } });
    await expect(deletePromo(promo.id)).rejects.toThrow(ConflictError);

    await prisma.promoRedemption.deleteMany({ where: { promoId: promo.id } });
    await deletePromo(promo.id);
    await expect(updatePromo(promo.id, { active: true })).rejects.toThrow(NotFoundError);
  });
});
