import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import { adminListUsers, adminUpdateUser, createStaffUser, setUserStatus } from "../src/modules/users/service.js";
import { ConflictError, NotFoundError } from "../src/shared/errors.js";

const userIds: string[] = [];
const suffix = Date.now();

describe("admin user management", () => {
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("creates a staff user with a hashed password and audit-logs the creation", async () => {
    const user = await createStaffUser("actor-1", {
      phone: `+2010001${suffix}`,
      email: `staff-${suffix}@example.com`,
      password: "supersecret1",
      name: "Staff One",
      role: "staff",
    });
    userIds.push(user.id);

    expect(user.role).toBe("staff");
    expect(user.status).toBe("active");

    const raw = await prisma.user.findUnique({ where: { id: user.id } });
    expect(raw?.passwordHash).toBeTruthy();
    expect(raw?.passwordHash).not.toBe("supersecret1");

    const entry = await prisma.auditLog.findFirst({ where: { actorId: "actor-1", action: "user.create", targetId: user.id } });
    expect(entry).not.toBeNull();
  });

  it("rejects a duplicate phone or email", async () => {
    const phone = `+2010002${suffix}`;
    const email = `dup-${suffix}@example.com`;
    const user = await createStaffUser("actor-1", { phone, email, password: "supersecret1", name: "Dup", role: "staff" });
    userIds.push(user.id);

    await expect(
      createStaffUser("actor-1", { phone, email: `other-${suffix}@example.com`, password: "supersecret1", name: "X", role: "staff" }),
    ).rejects.toThrow(ConflictError);

    await expect(
      createStaffUser("actor-1", { phone: `+2010003${suffix}`, email, password: "supersecret1", name: "X", role: "staff" }),
    ).rejects.toThrow(ConflictError);
  });

  it("lists users filtered by role and search", async () => {
    const user = await createStaffUser("actor-1", {
      phone: `+2010004${suffix}`,
      email: `dispatcher-${suffix}@example.com`,
      password: "supersecret1",
      name: "Findme Dispatcher",
      role: "dispatcher",
    });
    userIds.push(user.id);

    const byRole = await adminListUsers({ role: "dispatcher" });
    expect(byRole.some((u) => u.id === user.id)).toBe(true);

    const bySearch = await adminListUsers({ search: "Findme" });
    expect(bySearch.some((u) => u.id === user.id)).toBe(true);
  });

  it("updates a user's name/email and audit-logs a role assignment", async () => {
    const role = await prisma.staffRole.create({ data: { name: `AdminUsersTestRole-${suffix}` } });
    const user = await createStaffUser("actor-1", {
      phone: `+2010005${suffix}`,
      email: `edit-${suffix}@example.com`,
      password: "supersecret1",
      name: "Edit Me",
      role: "staff",
    });
    userIds.push(user.id);

    const updated = await adminUpdateUser("actor-1", user.id, { name: "Edited Name", staffRoleId: role.id });
    expect(updated.name).toBe("Edited Name");
    expect(updated.staffRoleId).toBe(role.id);

    const entry = await prisma.auditLog.findFirst({
      where: { actorId: "actor-1", action: "user.role_assign", targetId: user.id },
    });
    expect(entry).not.toBeNull();

    await prisma.user.update({ where: { id: user.id }, data: { staffRoleId: null } });
    await prisma.staffRole.delete({ where: { id: role.id } });
  });

  it("suspends and reactivates a user, audit-logging each change", async () => {
    const user = await createStaffUser("actor-1", {
      phone: `+2010006${suffix}`,
      email: `status-${suffix}@example.com`,
      password: "supersecret1",
      name: "Status Test",
      role: "staff",
    });
    userIds.push(user.id);

    const suspended = await setUserStatus("actor-1", user.id, "suspended");
    expect(suspended.status).toBe("suspended");

    const reactivated = await setUserStatus("actor-1", user.id, "active");
    expect(reactivated.status).toBe("active");

    const entries = await prisma.auditLog.findMany({
      where: { actorId: "actor-1", action: "user.status_change", targetId: user.id },
    });
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  it("404s updating or suspending an unknown user", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    await expect(adminUpdateUser("actor-1", unknownId, { name: "X" })).rejects.toThrow(NotFoundError);
    await expect(setUserStatus("actor-1", unknownId, "banned")).rejects.toThrow(NotFoundError);
  });
});
