// vehicles module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";

export async function listActiveVehicleTypes() {
  return prisma.vehicleType.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      icon: true,
      seats: true,
      baseFare: true,
      perKm: true,
      perMin: true,
      minFare: true,
    },
    orderBy: { baseFare: "asc" },
  });
}
