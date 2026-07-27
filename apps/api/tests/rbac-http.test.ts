import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signAccessToken } from "../src/modules/auth/tokens.js";
import type { AuthUser } from "../src/middleware/auth.js";

/**
 * Phase 5.2 RBAC audit: route-level gating (STAFF_ONLY/OPS_ROLES/fleet_owner
 * split from Phase 4.4, plus the older per-router requireRole gates) had
 * only ever been checked manually over a real dev server, never by an
 * automated test — see CLAUDE.md's Phase 4.4 note. This exercises the
 * actual Express middleware chain over real HTTP rather than calling
 * service functions directly, which is the only way to catch a route
 * that's missing its guard entirely.
 *
 * Tokens are minted directly via signAccessToken rather than through a real
 * login — requireAuth/requireRole only ever inspect the JWT payload, never
 * hit the DB, so a fake (nonexistent) userId is fine for a pure gating test.
 */
const app = createApp();

function tokenFor(role: AuthUser["role"]): string {
  return signAccessToken({ id: "00000000-0000-0000-0000-000000000000", role });
}

function authed(method: "get" | "post", path: string, role?: AuthUser["role"]) {
  const req = request(app)[method](path);
  return role ? req.set("Authorization", `Bearer ${tokenFor(role)}`) : req;
}

describe("RBAC route gating over real HTTP (Phase 5.2 audit)", () => {
  it("rejects an unauthenticated request to an admin route", async () => {
    const res = await authed("get", "/api/v1/admin/dashboard");
    expect(res.status).toBe(401);
  });

  it("rejects a driver token on an admin/staff-only route", async () => {
    const res = await authed("get", "/api/v1/admin/dashboard", "driver");
    expect(res.status).toBe(403);
  });

  it("admits a dispatcher to an OPS_ROLES route but rejects them from a STAFF_ONLY route", async () => {
    const ops = await authed("get", "/api/v1/admin/dashboard", "dispatcher");
    expect(ops.status).not.toBe(403);

    const staffOnly = await authed("get", "/api/v1/admin/drivers", "dispatcher");
    expect(staffOnly.status).toBe(403);
  });

  it("fleet_owner reaches only /admin/my-fleet, not the rest of /admin", async () => {
    const myFleet = await authed("get", "/api/v1/admin/my-fleet", "fleet_owner");
    expect(myFleet.status).not.toBe(403);

    const dashboard = await authed("get", "/api/v1/admin/dashboard", "fleet_owner");
    expect(dashboard.status).toBe(403);
  });

  it("rejects a rider token on a driver-only route", async () => {
    const res = await authed("post", "/api/v1/drivers/register", "rider");
    expect(res.status).toBe(403);
  });

  it("admits any authenticated role to /drivers/nearby (rider-app map uses it too)", async () => {
    const res = await request(app)
      .get("/api/v1/drivers/nearby")
      .query({ lat: 30.05, lng: 31.23, vehicleTypeId: "00000000-0000-0000-0000-000000000000" })
      .set("Authorization", `Bearer ${tokenFor("rider")}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("rejects a driver token on a dispatcher/admin/staff-only manual-booking route", async () => {
    const res = await authed("post", "/api/v1/dispatch/manual-booking", "driver").send({});
    expect(res.status).toBe(403);
  });

  it("rejects a rider token on a driver-only /payouts route", async () => {
    const res = await authed("get", "/api/v1/payouts/me", "rider");
    expect(res.status).toBe(403);
  });
});
