import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver, getDemandHeatmap, getSupplyHeatmap, getTripDetailForAdmin, listActiveTripsForMap, listOnlineDrivers } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse } from "../src/modules/dispatch/service.js";
import { arriveTrip, flushTripLocations, relayAndRecordTripLocation, startTrip } from "../src/modules/trips/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { NotFoundError } from "../src/shared/errors.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
const userIds: string[] = [];
const vehicleTypeIds: string[] = [];
const tripIds: string[] = [];

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

async function cleanupTrip(tripId: string): Promise<void> {
  await prisma.tripLocation.deleteMany({ where: { tripId } });
  await prisma.ledgerEntry.deleteMany({ where: { tripId } });
  await prisma.trip.delete({ where: { id: tripId } });
}

describe("admin live ops", () => {
  beforeAll(async () => {
    const vt = await prisma.vehicleType.create({
      data: {
        name: `LiveOpsTest-${Date.now()}-${Math.random()}`,
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
    for (const id of tripIds) {
      await cleanupTrip(id).catch(() => undefined);
    }
    for (const id of userIds) {
      await prisma.oweAmount.deleteMany({ where: { driverId: id } });
      await prisma.vehicle.deleteMany({ where: { driverId: id } });
      await prisma.driverProfile.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("listOnlineDrivers reports identity + live position for an online driver", async () => {
    const driver = await makeOnlineDriver("+201000066601", "LIVEOPS-001", 30.011, 31.211);

    const drivers = await listOnlineDrivers();
    const entry = drivers.find((d) => d.driverId === driver);
    expect(entry).toBeDefined();
    expect(entry?.plate).toBe("LIVEOPS-001");
    expect(entry?.lat).toBeCloseTo(30.011, 3);
    expect(entry?.lng).toBeCloseTo(31.211, 3);

    await setAvailability(driver, false);
    const afterOffline = await listOnlineDrivers();
    expect(afterOffline.some((d) => d.driverId === driver)).toBe(false);
  });

  it("listActiveTripsForMap includes an accepted trip with pickup/drop and driver location, excludes paid ones", async () => {
    const rider = await makeRider("+201000066602");
    const driver = await makeOnlineDriver("+201000066603", "LIVEOPS-002", 30.0505, 31.2305);
    const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip.id);
    await handleDriverResponse(trip.id, driver, true);

    const active = await listActiveTripsForMap();
    const entry = active.find((t) => t.tripId === trip.id);
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("accepted");
    expect(entry?.driverId).toBe(driver);
    expect(entry?.pickup?.lat).toBeCloseTo(pickup.lat, 3);
    expect(entry?.drop?.lat).toBeCloseTo(drop.lat, 3);
    expect(entry?.driverLocation?.lat).toBeCloseTo(30.0505, 3);
  });

  it("getTripDetailForAdmin returns trip + route replay, 404s on an unknown trip", async () => {
    const rider = await makeRider("+201000066604");
    const driver = await makeOnlineDriver("+201000066605", "LIVEOPS-003", 30.0505, 31.2305);
    const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip.id);
    await handleDriverResponse(trip.id, driver, true);
    await arriveTrip(trip.id, driver);
    await startTrip(trip.id, driver, trip.otp!);

    await relayAndRecordTripLocation(driver, { lat: 30.051, lng: 31.231, speed: 20 });
    await relayAndRecordTripLocation(driver, { lat: 30.052, lng: 31.232, speed: 22 });
    await flushTripLocations();

    const detail = await getTripDetailForAdmin(trip.id);
    expect(detail.rider.id).toBe(rider);
    expect(detail.driver?.id).toBe(driver);
    expect(detail.pickup?.lat).toBeCloseTo(pickup.lat, 3);
    expect(detail.route).toHaveLength(2);
    expect(detail.route[0]?.lat).toBeCloseTo(30.051, 3);

    await expect(getTripDetailForAdmin("00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);
  });

  it("getDemandHeatmap returns pickup points, filterable by a time window", async () => {
    const rider = await makeRider("+201000066606");
    const trip = await requestTrip(rider, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    tripIds.push(trip.id);

    const all = await getDemandHeatmap();
    expect(all.some((p) => Math.abs(p.lat - pickup.lat) < 0.001 && Math.abs(p.lng - pickup.lng) < 0.001)).toBe(true);

    const past = await getDemandHeatmap(new Date("2000-01-01"), new Date("2000-01-02"));
    expect(past.some((p) => Math.abs(p.lat - pickup.lat) < 0.001)).toBe(false);
  });

  it("getSupplyHeatmap mirrors listOnlineDrivers' positions", async () => {
    const driver = await makeOnlineDriver("+201000066607", "LIVEOPS-004", 30.077, 31.277);

    const heatmap = await getSupplyHeatmap();
    expect(heatmap.some((p) => Math.abs(p.lat - 30.077) < 0.001 && Math.abs(p.lng - 31.277) < 0.001)).toBe(true);

    await setAvailability(driver, false);
  });
});
