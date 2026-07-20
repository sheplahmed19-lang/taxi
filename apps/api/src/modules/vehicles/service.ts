// vehicles module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { NotFoundError } from "../../shared/errors.js";

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

// ── Admin vehicle-type & vehicle management (Phase 4.2) ────────────────────

/** Every vehicle type, including inactive ones — the public listActiveVehicleTypes() only ever shows active. */
export async function listAllVehicleTypes() {
  return prisma.vehicleType.findMany({ orderBy: { baseFare: "asc" } });
}

export interface VehicleTypeInput {
  name: string;
  icon?: string;
  seats: number;
  baseFare: number;
  perKm: number;
  perMin: number;
  minFare: number;
  nightMultiplier?: number;
  nightStart?: string;
  nightEnd?: string;
  commissionPct?: number;
  active?: boolean;
}

export async function createVehicleType(data: VehicleTypeInput) {
  return prisma.vehicleType.create({ data });
}

export async function updateVehicleType(id: string, data: Partial<VehicleTypeInput>) {
  const existing = await prisma.vehicleType.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Vehicle type not found");
  }
  return prisma.vehicleType.update({ where: { id }, data });
}

export interface ListVehiclesQuery {
  driverId?: string;
}

export async function listVehicles(query: ListVehiclesQuery) {
  return prisma.vehicle.findMany({
    where: { driverId: query.driverId },
    include: {
      vehicleType: true,
      currentDriver: { include: { user: { select: { id: true, name: true, phone: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface UpdateVehicleInput {
  plate?: string;
  model?: string;
  color?: string;
  year?: number;
  vehicleTypeId?: string;
}

export async function updateVehicle(id: string, data: UpdateVehicleInput) {
  const existing = await prisma.vehicle.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("Vehicle not found");
  }
  return prisma.vehicle.update({ where: { id }, data, include: { vehicleType: true } });
}
