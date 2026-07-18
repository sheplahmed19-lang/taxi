import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { applyPromoToTrip, arriveTrip, cancelTrip, completeTrip, startTrip } from "../src/modules/trips/service.js";
import { createPromo, previewPromo } from "../src/modules/promos/service.js";
import { estimateFares } from "../src/modules/fares/service.js";
import { ConflictError } from "../src/shared/errors.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];
const promoCodes: string[] = [];

async function makeRider(phone: string): Promise<string> {
  const user = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone, role: "rider" } });
  userIds.push(user.id);
  return user.id;
}

async function makeOnlineDriver(phone: string, plate: string, lat: number, lng: number): Promise<string> {
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, role: "driver", wallet: { create: { balance: 0 } } },
  });
  await registerDriver(user.id, { vehicleTypeId, plate });
  await approveDriver(user.id);
  await setAvailability(user.id, true);
  await recordLocation(user.id, { lat, lng });
  userIds.push(user.id);
  return user.id;
}

async function makePromo(overrides: Partial<Parameters<typeof createPromo>[0]> = {}) {
  const code = `TRIPPROMO${Date.now()}${Math.floor(Math.random() * 100000)}`;
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

async function cleanupTrip(tripId: string): Promise<void> {
  await prisma.promoRedemption.deleteMany({ where: { tripId } });
  await prisma.tripLocation.deleteMany({ where: { tripId } });
  await prisma.ledgerEntry.deleteMany({ where: { tripId } });
  await prisma.trip.delete({ where: { id: tripId } });
}

describe("promo codes on trips", () => {
  beforeEach(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `PromoTripTest-${Date.now()}-${Math.random()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        active: true,
      },
    });
    vehicleTypeId = vt.id;
    vehicleTypeIds.push(vt.id);
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    await prisma.promoRedemption.deleteMany({ where: { promo: { code: { in: promoCodes } } } });
    await prisma.promoCode.deleteMany({ where: { code: { in: promoCodes } } });
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("discounts the fare at creation and records a redemption", async () => {
    const promo = await makePromo({ type: "flat", value: 200 });
    const rider = await makeRider("+201000099901");

    const [estimate] = await estimateFares(pickup, drop, vehicleTypeId);
    const preDiscountTotal = estimate!.breakdown.total;

    const trip = await requestTrip(rider, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      promoCode: promo.code,
    });

    expect(trip.promoId).toBe(promo.id);
    expect(trip.fareTotal).toBe(preDiscountTotal - 200);
    expect((trip.fareBreakdown as { promoDiscount: number }).promoDiscount).toBe(200);

    const redemption = await prisma.promoRedemption.findFirst({ where: { tripId: trip.id, promoId: promo.id } });
    expect(redemption).not.toBeNull();

    await cleanupTrip(trip.id);
  });

  it("rejects an invalid promo at trip creation without creating the trip", async () => {
    const rider = await makeRider("+201000099902");
    await expect(
      requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash", promoCode: "NOPE-NOT-REAL" }),
    ).rejects.toThrow();

    const trips = await prisma.trip.findMany({ where: { riderId: rider } });
    expect(trips).toHaveLength(0);
  });

  it("cancelling a trip releases its promo redemption", async () => {
    const promo = await makePromo({ perUserLimit: 1 });
    const rider = await makeRider("+201000099903");
    await makeOnlineDriver("+201000099913", "PROMO-000", 30.0505, 31.2305); // rider_cancel isn't valid from no_drivers_found

    const trip = await requestTrip(rider, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      promoCode: promo.code,
    });
    await cancelTrip(trip.id, rider, "changed my mind");

    const redemption = await prisma.promoRedemption.findFirst({ where: { tripId: trip.id } });
    expect(redemption).toBeNull();

    // Since the slot was released, this perUserLimit:1 promo is usable again — checked
    // directly against the validation service rather than a second real dispatch, which
    // would need the just-cancelled trip's driver-offer lock to expire first.
    const preview = await previewPromo(rider, promo.code, pickup, drop, vehicleTypeId);
    expect(preview.promo.id).toBe(promo.id);

    await cleanupTrip(trip.id);
  });

  it("applyPromoToTrip attaches a code to a trip requested without one, before it starts", async () => {
    const promo = await makePromo({ type: "flat", value: 150 });
    const rider = await makeRider("+201000099904");
    const driver = await makeOnlineDriver("+201000099914", "PROMO-001", 30.0505, 31.2305);

    const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    await handleDriverResponse(trip.id, driver, true);
    const preDiscountTotal = (await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).fareTotal!;

    const updated = await applyPromoToTrip(trip.id, rider, promo.code);
    expect(updated.promoId).toBe(promo.id);
    expect(updated.fareTotal).toBe(preDiscountTotal - 150);

    await expect(applyPromoToTrip(trip.id, rider, promo.code)).rejects.toThrow(ConflictError);

    await cleanupTrip(trip.id);
  });

  it("locks the promo's terms through completion, re-applied against the final measured fare", async () => {
    const promo = await makePromo({ type: "percent", value: 10 });
    const rider = await makeRider("+201000099905");
    const driver = await makeOnlineDriver("+201000099915", "PROMO-002", 30.0505, 31.2305);

    const trip = await requestTrip(rider, {
      pickup,
      drop,
      vehicleTypeId,
      paymentMethod: "cash",
      promoCode: promo.code,
    });
    await handleDriverResponse(trip.id, driver, true);
    await arriveTrip(trip.id, driver);
    await startTrip(trip.id, driver, trip.otp!);

    const completed = await completeTrip(trip.id, driver);
    expect(completed.promoId).toBe(promo.id);
    const breakdown = completed.fareBreakdown as { promoDiscount: number; total: number };
    expect(breakdown.promoDiscount).toBeGreaterThan(0);
    // 10% of the (floored) pre-discount total, matching applyPromoDiscount's rounding.
    const preDiscountTotal = breakdown.total + breakdown.promoDiscount;
    expect(breakdown.promoDiscount).toBe(Math.round(preDiscountTotal * 0.1));

    await cleanupTrip(trip.id);
  });
});
