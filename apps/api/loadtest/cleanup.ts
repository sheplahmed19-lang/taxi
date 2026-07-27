// Phase 5.1 load test: removes every row prepare.ts + a load-test run
// created (drivers, riders, trips, vehicles, ledger entries) — a run leaves
// real data behind (trips, ledger entries from accepted rides) that must
// not linger in a shared dev/test database.
import { readFileSync } from "node:fs";
import { prisma } from "../src/db/index.js";

async function main() {
  const fixtures = JSON.parse(readFileSync(new URL("./.fixtures.json", import.meta.url), "utf8")) as {
    vehicleTypeId: string;
    drivers: { id: string }[];
    riders: { id: string }[];
  };

  const driverIds = fixtures.drivers.map((d) => d.id);
  const riderIds = fixtures.riders.map((r) => r.id);
  const userIds = [...driverIds, ...riderIds];

  const tripIds = (
    await prisma.trip.findMany({
      where: { OR: [{ riderId: { in: riderIds } }, { driverId: { in: driverIds } }] },
      select: { id: true },
    })
  ).map((t) => t.id);

  console.log(`Cleaning up ${tripIds.length} trips, ${driverIds.length} drivers, ${riderIds.length} riders...`);

  await prisma.tripLocation.deleteMany({ where: { tripId: { in: tripIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { tripId: { in: tripIds } } });
  await prisma.rating.deleteMany({ where: { tripId: { in: tripIds } } });
  await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });

  await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId: { in: driverIds } } } });
  await prisma.oweAmount.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.vehicle.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.driverProfile.deleteMany({ where: { userId: { in: driverIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: driverIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.vehicleType.deleteMany({ where: { id: fixtures.vehicleTypeId } });

  console.log("Cleanup done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
