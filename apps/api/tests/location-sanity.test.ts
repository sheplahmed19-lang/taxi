import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/index.js";
import { redis } from "../src/shared/redis.js";
import { geoSetKey, recordLocation, registerDriver, setAvailability, stateKey } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { logger } from "../src/shared/logger.js";

const phone = `+201000055${Date.now().toString().slice(-6)}`;
let userId: string;
let vehicleTypeId: string;

// Pickup/drop points used elsewhere are ~1.5km apart — a jump nearly 100x
// that distance is implausible for any real vehicle in a few seconds.
const nearPoint = { lat: 30.05, lng: 31.23 };
const farPoint = { lat: 30.55, lng: 31.73 }; // ~65km away

describe("GPS-spoof mitigations — location sanity checks (Phase 5.2)", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "driver" },
    });
    userId = user.id;

    const vehicleType = await prisma.vehicleType.findFirstOrThrow({ where: { name: "Economy" } });
    vehicleTypeId = vehicleType.id;

    await registerDriver(userId, { vehicleTypeId, plate: `SANITY-${Date.now()}` });
    await approveDriver(userId);
    await setAvailability(userId, true);
  });

  afterEach(async () => {
    await redis.zrem(geoSetKey(vehicleTypeId), userId);
    await redis.del(stateKey(userId));
  });

  afterAll(async () => {
    await prisma.oweAmount.deleteMany({ where: { driverId: userId } });
    await prisma.vehicle.deleteMany({ where: { driverId: userId } });
    await prisma.driverProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("accepts a normal, physically-plausible sequence of pings", async () => {
    const t0 = Date.now();
    const first = await recordLocation(userId, { ...nearPoint, ts: t0 });
    expect(first.accepted).toBe(true);

    // ~30m over 5s ≈ 22 km/h — an ordinary city-driving update.
    const second = await recordLocation(userId, { lat: 30.0503, lng: 31.2303, ts: t0 + 5000 });
    expect(second.accepted).toBe(true);

    const state = await redis.hgetall(stateKey(userId));
    expect(Number(state.lat)).toBeCloseTo(30.0503, 3);
  });

  it("rejects a ping that implies an impossible speed since the previous one", async () => {
    const t0 = Date.now();
    await recordLocation(userId, { ...nearPoint, ts: t0 });

    // ~65km in 5s is a physically impossible jump for a car.
    const result = await recordLocation(userId, { ...farPoint, ts: t0 + 5000 });
    expect(result.accepted).toBe(false);

    // The rejected ping must not have overwritten the last-good state.
    const state = await redis.hgetall(stateKey(userId));
    expect(Number(state.lat)).toBeCloseTo(nearPoint.lat, 3);

    const inPool = await redis.zscore(geoSetKey(vehicleTypeId), userId);
    expect(inPool).not.toBeNull(); // still present at the last accepted position
  });

  it("does not flag a large jump as implausible when little time has actually elapsed (GPS jitter)", async () => {
    const t0 = Date.now();
    await recordLocation(userId, { ...nearPoint, ts: t0 });

    // Same huge jump as above, but within the jitter-tolerance window — the
    // speed check must not fire on noise alone.
    const result = await recordLocation(userId, { ...farPoint, ts: t0 + 500 });
    expect(result.accepted).toBe(true);
  });

  it("respects an overridden max_plausible_speed_kmh from system_config", async () => {
    // Stubbed rather than written through the real admin setConfigValue —
    // that edits a DB row shared with every other test file running in
    // parallel against the same database (CLAUDE.md rule 10 makes this a
    // real, global tunable), and this test only needs to prove recordLocation
    // actually reads the config value rather than a hardcoded constant.
    const configModule = await import("../src/shared/config.js");
    // recordLocation only calls getConfigValue once there's a previous ping
    // to compare against, so this is consumed by the second call below, not
    // the first.
    const spy = vi.spyOn(configModule, "getConfigValue").mockResolvedValueOnce(20);
    try {
      const t0 = Date.now();
      await recordLocation(userId, { ...nearPoint, ts: t0 });
      // ~30m over 5s ≈ 22 km/h — plausible under the default 180 km/h cap,
      // but now above this test's tightened 20 km/h cap.
      const result = await recordLocation(userId, { lat: 30.0503, lng: 31.2303, ts: t0 + 5000 });
      expect(result.accepted).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("logs a warning when a ping is flagged isMocked by the device, without rejecting it outright", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const result = await recordLocation(userId, { ...nearPoint, ts: Date.now(), isMocked: true });
    expect(result.accepted).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ userId }), expect.stringMatching(/mocked/i));
    warnSpy.mockRestore();
  });
});
