import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { issueRefreshToken, rotateRefreshToken, signAccessToken, verifyAccessToken } from "../src/modules/auth/tokens.js";

const phone = "+201000088888";
let userId: string;

describe("tokens", () => {
  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, role: "rider" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("signs and verifies an access token round-trip", () => {
    const token = signAccessToken({ id: userId, role: "rider" });
    const payload = verifyAccessToken(token);
    expect(payload.id).toBe(userId);
    expect(payload.role).toBe("rider");
  });

  it("rejects a tampered access token", () => {
    const token = signAccessToken({ id: userId, role: "rider" });
    expect(() => verifyAccessToken(token.slice(0, -1) + "x")).toThrow();
  });

  it("rotates a refresh token and revokes the old one", async () => {
    const original = await issueRefreshToken(userId);

    const rotated = await rotateRefreshToken(original);
    expect(rotated).not.toBeNull();
    expect(rotated?.userId).toBe(userId);
    expect(rotated?.token).not.toBe(original);

    // The old token must not be usable again.
    const reuse = await rotateRefreshToken(original);
    expect(reuse).toBeNull();

    // The newly rotated token must still work.
    const second = await rotateRefreshToken(rotated!.token);
    expect(second).not.toBeNull();
  });

  it("rejects an unknown refresh token", async () => {
    const result = await rotateRefreshToken("not-a-real-token");
    expect(result).toBeNull();
  });

  it("rejects an expired refresh token", async () => {
    const token = await issueRefreshToken(userId);

    // Force expiry directly rather than waiting 30 real days.
    const hash = (await import("node:crypto")).createHash("sha256").update(token).digest("hex");
    await prisma.refreshToken.update({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await rotateRefreshToken(token);
    expect(result).toBeNull();
  });
});
