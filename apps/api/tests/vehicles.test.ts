import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { listActiveVehicleTypes } from "../src/modules/vehicles/service.js";

describe("vehicles/service listActiveVehicleTypes", () => {
  const vehicleTypeIds: string[] = [];

  afterAll(async () => {
    await prisma.vehicleType.deleteMany({ where: { id: { in: vehicleTypeIds } } });
    await prisma.$disconnect();
  });

  it("returns only active vehicle types, cheapest first", async () => {
    const active = await prisma.vehicleType.create({
      data: {
        name: `VehiclesTest-active-${Date.now()}`,
        baseFare: 100,
        perKm: 50,
        perMin: 10,
        minFare: 300,
        active: true,
      },
    });
    const inactive = await prisma.vehicleType.create({
      data: {
        name: `VehiclesTest-inactive-${Date.now()}`,
        baseFare: 50,
        perKm: 20,
        perMin: 5,
        minFare: 100,
        active: false,
      },
    });
    vehicleTypeIds.push(active.id, inactive.id);

    const types = await listActiveVehicleTypes();

    expect(types.some((t) => t.id === inactive.id)).toBe(false);
    const found = types.find((t) => t.id === active.id);
    expect(found).toBeDefined();
    expect(found).toMatchObject({ name: active.name, baseFare: 100, perKm: 50, perMin: 10, minFare: 300 });

    const baseFares = types.map((t) => t.baseFare);
    expect(baseFares).toEqual([...baseFares].sort((a, b) => a - b));
  });
});
