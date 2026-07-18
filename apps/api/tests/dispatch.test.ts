import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { redis } from "../src/shared/redis.js";
import { registerDriver, setAvailability, recordLocation, geoSetKey } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { requestTrip, handleDriverResponse, handleDispatchTimeout } from "../src/modules/dispatch/service.js";
import { closeDispatchTimeout } from "../src/jobs/dispatchTimeout.js";
import { ConflictError } from "../src/shared/errors.js";

const pickup = { lat: 30.05, lng: 31.23 };
const drop = { lat: 30.06, lng: 31.24 };

let vehicleTypeId: string;
let riderId: string;
const riderIds: string[] = [];
const driverIds: string[] = [];

async function makeOnlineDriver(phone: string, plate: string, lat: number, lng: number): Promise<string> {
  const user = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone, role: "driver" } });
  await registerDriver(user.id, { vehicleTypeId, plate });
  await approveDriver(user.id);
  await setAvailability(user.id, true);
  await recordLocation(user.id, { lat, lng });
  driverIds.push(user.id);
  return user.id;
}

async function makeRider(phone: string): Promise<string> {
  const user = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone, role: "rider" } });
  riderIds.push(user.id);
  return user.id;
}

async function cleanupTripState(riderIdToClean: string): Promise<void> {
  const trips = await prisma.trip.findMany({ where: { riderId: riderIdToClean }, select: { id: true } });
  for (const trip of trips) {
    await redis.del(
      `trip:${trip.id}:dispatch:offered`,
      `trip:${trip.id}:dispatch:current`,
      `trip:${trip.id}:dispatch:radius`,
      `trip:${trip.id}:dispatch:expanded`,
    );
  }
  await prisma.trip.deleteMany({ where: { riderId: riderIdToClean } });
}

describe("dispatch engine", () => {
  beforeAll(async () => {
    // A dedicated vehicle type (not the shared seeded "Economy") so this
    // file's drivers:online:{vehicleTypeId} GEO set can't collide with
    // drivers created by other test files running concurrently — several of
    // them use "Economy" at nearby/identical coordinates, and this suite is
    // sensitive to exact nearest-candidate selection.
    const vt = await prisma.vehicleType.create({
      data: {
        name: `DispatchTest-${Date.now()}`,
        baseFare: 500,
        perKm: 150,
        perMin: 20,
        minFare: 1000,
        nightStart: "22:00",
        nightEnd: "06:00",
        active: true,
      },
    });
    vehicleTypeId = vt.id;
  });

  afterEach(async () => {
    if (riderId) {
      await cleanupTripState(riderId);
    }
    for (const driverId of driverIds) {
      await redis.del(`dispatch:lock:driver:${driverId}`);
      await redis.zrem(geoSetKey(vehicleTypeId), driverId);
      await redis.del(`driver:${driverId}:state`);
    }
  });

  afterAll(async () => {
    await closeDispatchTimeout();
    for (const driverId of driverIds) {
      await prisma.vehicle.deleteMany({ where: { driverId } });
      await prisma.driverProfile.deleteMany({ where: { userId: driverId } });
    }
    await prisma.user.deleteMany({
      where: { id: { in: [...driverIds, ...riderIds] } },
    });
    await prisma.vehicleType.delete({ where: { id: vehicleTypeId } });
    await prisma.$disconnect();
  });

  it("offers a new trip to the single nearest online driver", async () => {
    riderId = await makeRider("+201000011111");
    const near = await makeOnlineDriver("+201000021111", "DISP-001", 30.0505, 31.2305); // ~70m away
    const far = await makeOnlineDriver("+201000021112", "DISP-002", 30.06, 31.24); // ~1.3km away

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    expect(trip.status).toBe("searching");

    const currentDriver = await redis.get(`trip:${trip.id}:dispatch:current`);
    expect(currentDriver).toBe(near);
    expect(currentDriver).not.toBe(far);
  });

  it("rejects trip creation when the rider already has an active trip", async () => {
    riderId = await makeRider("+201000011112");
    await makeOnlineDriver("+201000021113", "DISP-003", 30.0505, 31.2305);

    await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    await expect(requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("cascades to the next candidate on explicit reject", async () => {
    riderId = await makeRider("+201000011113");
    const first = await makeOnlineDriver("+201000021114", "DISP-004", 30.0505, 31.2305);
    const second = await makeOnlineDriver("+201000021115", "DISP-005", 30.052, 31.232);

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    expect(await redis.get(`trip:${trip.id}:dispatch:current`)).toBe(first);

    await handleDriverResponse(trip.id, first, false);

    expect(await redis.get(`trip:${trip.id}:dispatch:current`)).toBe(second);
    // Rejected driver's lock must be released so they're free for other trips.
    expect(await redis.get(`dispatch:lock:driver:${first}`)).toBeNull();
  });

  it("cascades to the next candidate on timeout", async () => {
    riderId = await makeRider("+201000011114");
    const first = await makeOnlineDriver("+201000021116", "DISP-006", 30.0505, 31.2305);
    const second = await makeOnlineDriver("+201000021117", "DISP-007", 30.052, 31.232);

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    expect(await redis.get(`trip:${trip.id}:dispatch:current`)).toBe(first);

    await handleDispatchTimeout(trip.id, first);

    expect(await redis.get(`trip:${trip.id}:dispatch:current`)).toBe(second);
  });

  it("ignores a stale timeout for a driver who is no longer the current offer", async () => {
    riderId = await makeRider("+201000011115");
    const first = await makeOnlineDriver("+201000021118", "DISP-008", 30.0505, 31.2305);
    await makeOnlineDriver("+201000021119", "DISP-009", 30.052, 31.232);

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    await handleDriverResponse(trip.id, first, false); // cascades past `first`

    const currentAfterReject = await redis.get(`trip:${trip.id}:dispatch:current`);

    // A stale timeout job for the already-rejected first driver must be a no-op.
    await handleDispatchTimeout(trip.id, first);
    expect(await redis.get(`trip:${trip.id}:dispatch:current`)).toBe(currentAfterReject);
  });

  it("accept transitions the trip to accepted and removes the driver from the GEO index", async () => {
    riderId = await makeRider("+201000011116");
    const driverId = await makeOnlineDriver("+201000021120", "DISP-010", 30.0505, 31.2305);

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    await handleDriverResponse(trip.id, driverId, true);

    const updated = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(updated.status).toBe("accepted");
    expect(updated.driverId).toBe(driverId);
    expect(updated.acceptedAt).not.toBeNull();

    const stillOnline = await redis.zscore(geoSetKey(vehicleTypeId), driverId);
    expect(stillOnline).toBeNull();

    // Dispatch state should be fully cleared after acceptance.
    expect(await redis.get(`trip:${trip.id}:dispatch:current`)).toBeNull();
    expect(await redis.get(`dispatch:lock:driver:${driverId}`)).toBeNull();
  });

  it("a second accept attempt after the first is claimed is a no-op (first-accept-wins)", async () => {
    riderId = await makeRider("+201000011117");
    const driverId = await makeOnlineDriver("+201000021121", "DISP-011", 30.0505, 31.2305);

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    await handleDriverResponse(trip.id, driverId, true);

    // Replaying the same accept must not throw or change anything further.
    await expect(handleDriverResponse(trip.id, driverId, true)).resolves.toBeUndefined();
    const updated = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(updated.status).toBe("accepted");
  });

  it("expands the search radius once before giving up", async () => {
    riderId = await makeRider("+201000011118");
    // ~7.8km away: outside the seeded 5km default radius, inside the 10km expanded one.
    const farDriver = await makeOnlineDriver("+201000021122", "DISP-012", 30.12, 31.23);

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });

    expect(await redis.get(`trip:${trip.id}:dispatch:current`)).toBe(farDriver);
    expect(await redis.get(`trip:${trip.id}:dispatch:expanded`)).toBe("1");
  });

  it("marks no_drivers_found when nobody is within even the expanded radius", async () => {
    riderId = await makeRider("+201000011119");
    await makeOnlineDriver("+201000021123", "DISP-013", 30.55, 31.23); // ~55km away

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });

    expect(trip.status).toBe("no_drivers_found");
    expect(await redis.get(`trip:${trip.id}:dispatch:current`)).toBeNull();
  });

  it("a locked driver (already offered on another trip) is skipped", async () => {
    riderId = await makeRider("+201000011120");
    const locked = await makeOnlineDriver("+201000021124", "DISP-014", 30.0505, 31.2305);
    const free = await makeOnlineDriver("+201000021125", "DISP-015", 30.052, 31.232);

    await redis.set(`dispatch:lock:driver:${locked}`, "someone-elses-trip", "EX", 30, "NX");

    const trip = await requestTrip(riderId, { pickup, drop, vehicleTypeId, paymentMethod: "cash" });
    expect(await redis.get(`trip:${trip.id}:dispatch:current`)).toBe(free);

    await redis.del(`dispatch:lock:driver:${locked}`);
  });
});
