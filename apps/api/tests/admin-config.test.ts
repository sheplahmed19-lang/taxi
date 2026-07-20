import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { getConfigValue, listAllConfig, setConfigValue } from "../src/shared/config.js";
import { NotFoundError } from "../src/shared/errors.js";

const testKey = `admin_config_test_${Date.now()}`;

describe("admin config editor", () => {
  afterAll(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: testKey } });
    await prisma.$disconnect();
  });

  it("lists all config rows, ordered by key", async () => {
    const all = await listAllConfig();
    expect(all.length).toBeGreaterThan(0);
    const keys = all.map((c) => c.key);
    expect(keys).toEqual([...keys].sort());
  });

  it("edits an existing key and the change is visible immediately (cache invalidated)", async () => {
    await prisma.systemConfig.create({ data: { key: testKey, value: 1 } });

    expect(await getConfigValue(testKey, 0)).toBe(1);

    await setConfigValue(testKey, 42);

    expect(await getConfigValue(testKey, 0)).toBe(42);
  });

  it("404s editing an unknown key rather than inventing one", async () => {
    await expect(setConfigValue("this_key_does_not_exist", 1)).rejects.toThrow(NotFoundError);
    const row = await prisma.systemConfig.findUnique({ where: { key: "this_key_does_not_exist" } });
    expect(row).toBeNull();
  });
});
