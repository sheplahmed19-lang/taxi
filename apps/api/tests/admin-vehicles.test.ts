import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import {
  createVehicleType,
  listAllVehicleTypes,
  listVehicles,
  updateVehicle,
  updateVehicleType,
} from "../src/modules/vehicles/service.js";
import { NotFoundError } from "../src/shared/errors.js";

const suffix = Date.now();
const vehicleTypeIds: string[] = [];
const userIds: string[] = [];
const vehicleIds: string[] = [];

describe("admin vehicle-type & vehicle management", () => {
  afterAll(async () => {
    await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("creates a vehicle type and lists it, including inactive ones", async () => {
    const created = await createVehicleType({
      name: `AdminVTTest-${suffix}`,
      seats: 4,
      baseFare: 400,
      perKm: 100,
      perMin: 15,
      minFare: 800,
      active: false,
    });
    vehicleTypeIds.push(created.id);

    expect(created.active).toBe(false);

    const all = await listAllVehicleTypes();
    expect(all.some((vt) => vt.id === created.id)).toBe(true);
  });

  it("updates a vehicle type's fare fields", async () => {
    const created = await createVehicleType({
      name: `AdminVTTest-update-${suffix}`,
      seats: 4,
      baseFare: 400,
      perKm: 100,
      perMin: 15,
      minFare: 800,
    });
    vehicleTypeIds.push(created.id);

    const updated = await updateVehicleType(created.id, { baseFare: 600, active: true });
    expect(updated.baseFare).toBe(600);
    expect(updated.active).toBe(true);
  });

  it("404s updating an unknown vehicle type", async () => {
    await expect(updateVehicleType("00000000-0000-0000-0000-000000000000", { baseFare: 1 })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("lists vehicles filtered by driverId and updates a vehicle", async () => {
    const vt = await createVehicleType({
      name: `AdminVTTest-driver-${suffix}`,
      seats: 4,
      baseFare: 400,
      perKm: 100,
      perMin: 15,
      minFare: 800,
    });
    vehicleTypeIds.push(vt.id);

    const driver = await prisma.user.create({
      data: { phone: `+2010007${suffix}`, role: "driver", wallet: { create: { balance: 0 } } },
    });
    userIds.push(driver.id);
    await prisma.driverProfile.create({ data: { userId: driver.id, verificationStatus: "approved" } });

    const vehicle = await prisma.vehicle.create({
      data: { driverId: driver.id, vehicleTypeId: vt.id, plate: `ADMTEST-${suffix}`, model: "Corolla", color: "White" },
    });
    vehicleIds.push(vehicle.id);

    const listed = await listVehicles({ driverId: driver.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(vehicle.id);

    const updated = await updateVehicle(vehicle.id, { color: "Black" });
    expect(updated.color).toBe("Black");
  });

  it("404s updating an unknown vehicle", async () => {
    await expect(updateVehicle("00000000-0000-0000-0000-000000000000", { color: "Red" })).rejects.toThrow(
      NotFoundError,
    );
  });
});
