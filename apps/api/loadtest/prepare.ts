// Phase 5.1 load test: seeds synthetic drivers + riders for dispatch-load.js
// (k6) and driver-simulator.mjs to run against. Writes loadtest/.fixtures.json
// (gitignored) with pre-minted JWTs so the load scripts never have to go
// through the real OTP flow (dev-mode OTPs are only visible in server logs,
// not scriptable from k6 or a plain HTTP client).
import { writeFileSync } from "node:fs";
import { prisma } from "../src/db/index.js";
import { registerDriver, setAvailability, recordLocation } from "../src/modules/drivers/service.js";
import { approveDriver } from "../src/modules/admin/service.js";
import { signAccessToken } from "../src/modules/auth/tokens.js";

const DRIVER_COUNT = Number(process.env.LOADTEST_DRIVERS ?? 60);
const RIDER_COUNT = Number(process.env.LOADTEST_RIDERS ?? 300);
const CENTER = { lat: 30.05, lng: 31.23 };
const DROP = { lat: 30.08, lng: 31.28 }; // ~5km away — a realistic-length ride

function jitter(point: { lat: number; lng: number }, maxKm: number) {
  // ~0.009 degrees latitude per km at this latitude — close enough for a
  // synthetic scatter, not a distance calculation that needs to be exact.
  const deg = maxKm * 0.009;
  return { lat: point.lat + (Math.random() * 2 - 1) * deg, lng: point.lng + (Math.random() * 2 - 1) * deg };
}

async function main() {
  const suffix = Date.now();

  const vehicleType = await prisma.vehicleType.upsert({
    where: { name: "LoadTest Sedan" },
    update: { active: true },
    create: { name: "LoadTest Sedan", baseFare: 500, perKm: 150, perMin: 20, minFare: 1000, active: true },
  });

  console.log(`Seeding ${DRIVER_COUNT} online drivers...`);
  const drivers: { id: string; token: string }[] = [];
  for (let i = 0; i < DRIVER_COUNT; i++) {
    const phone = `+2018${String(suffix).slice(-6)}${String(i).padStart(3, "0")}`.slice(0, 15);
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "driver", name: `LoadTest Driver ${i}`, wallet: { create: { balance: 0 } } },
    });
    const existingVehicle = await prisma.vehicle.findFirst({ where: { driverId: user.id } });
    if (!existingVehicle) {
      await registerDriver(user.id, { vehicleTypeId: vehicleType.id, plate: `LOAD-${suffix}-${i}` });
      await approveDriver(user.id);
    }
    await setAvailability(user.id, true);
    const pos = jitter(CENTER, 3);
    await recordLocation(user.id, pos);
    drivers.push({ id: user.id, token: signAccessToken({ id: user.id, role: "driver" }) });
  }

  console.log(`Seeding ${RIDER_COUNT} riders...`);
  const riders: { id: string; token: string }[] = [];
  for (let i = 0; i < RIDER_COUNT; i++) {
    const phone = `+2017${String(suffix).slice(-6)}${String(i).padStart(4, "0")}`.slice(0, 15);
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "rider", name: `LoadTest Rider ${i}` },
    });
    riders.push({ id: user.id, token: signAccessToken({ id: user.id, role: "rider" }) });
  }

  const fixtures = {
    suffix,
    vehicleTypeId: vehicleType.id,
    pickup: CENTER,
    drop: DROP,
    drivers,
    riders,
  };
  writeFileSync(new URL("./.fixtures.json", import.meta.url), JSON.stringify(fixtures, null, 2));
  console.log(`Wrote loadtest/.fixtures.json — ${drivers.length} drivers, ${riders.length} riders.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
