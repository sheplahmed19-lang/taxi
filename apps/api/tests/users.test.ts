import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import {
  createFavorite,
  deleteFavorite,
  listFavorites,
  updateFavorite,
  updateProfile,
} from "../src/modules/users/service.js";

const phone = "+201000077777";
let userId: string;

describe("users service", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "rider" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.favoriteLocation.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("updates name and email", async () => {
    const profile = await updateProfile(userId, { name: "Alice", email: "alice@example.com" });
    expect(profile.name).toBe("Alice");
    expect(profile.email).toBe("alice@example.com");
  });

  it("creates, lists, updates, and deletes a favorite location", async () => {
    const created = await createFavorite(userId, { label: "Home", lat: 30.05, lng: 31.23 });
    expect(created.lat).toBeCloseTo(30.05, 5);
    expect(created.lng).toBeCloseTo(31.23, 5);

    const listed = await listFavorites(userId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.label).toBe("Home");

    const updated = await updateFavorite(userId, created.id, { label: "Home (updated)", lat: 30.06, lng: 31.24 });
    expect(updated?.label).toBe("Home (updated)");
    expect(updated?.lat).toBeCloseTo(30.06, 5);

    await deleteFavorite(userId, created.id);
    const afterDelete = await listFavorites(userId);
    expect(afterDelete).toHaveLength(0);
  });

  it("rejects updating/deleting a favorite that belongs to another user", async () => {
    const created = await createFavorite(userId, { label: "Work", lat: 30.0, lng: 31.0 });

    await expect(updateFavorite("00000000-0000-0000-0000-000000000000", created.id, { label: "Hijacked" })).rejects.toThrow(
      /not found/i,
    );
    await expect(deleteFavorite("00000000-0000-0000-0000-000000000000", created.id)).rejects.toThrow(/not found/i);

    await deleteFavorite(userId, created.id);
  });
});
