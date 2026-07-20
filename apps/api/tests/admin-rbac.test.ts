import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/index.js";
import {
  createRole,
  deleteRole,
  listPermissions,
  listRoles,
  updateRole,
  userHasPermission,
} from "../src/modules/admin/service.js";
import { ConflictError, NotFoundError } from "../src/shared/errors.js";

const suffix = Date.now();
const roleIds: string[] = [];
const permissionIds: string[] = [];
const userIds: string[] = [];

describe("roles & permissions CRUD", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
    await prisma.staffRole.deleteMany({ where: { id: { in: roleIds } } });
    await prisma.permission.deleteMany({ where: { id: { in: permissionIds } } });
    await prisma.$disconnect();
  });

  it("lists permissions ordered by key", async () => {
    const permission = await prisma.permission.create({ data: { key: `rbac.test.${suffix}` } });
    permissionIds.push(permission.id);

    const all = await listPermissions();
    expect(all.some((p) => p.id === permission.id)).toBe(true);
    const keys = all.map((p) => p.key);
    expect(keys).toEqual([...keys].sort());
  });

  it("creates a role with attached permissions", async () => {
    const p1 = await prisma.permission.create({ data: { key: `rbac.create.a.${suffix}` } });
    const p2 = await prisma.permission.create({ data: { key: `rbac.create.b.${suffix}` } });
    permissionIds.push(p1.id, p2.id);

    const role = await createRole({ name: `RbacTestRole-${suffix}`, permissionIds: [p1.id, p2.id] });
    roleIds.push(role.id);

    expect(role.rolePermissions).toHaveLength(2);
    const roles = await listRoles();
    const found = roles.find((r) => r.id === role.id);
    expect(found?.rolePermissions.map((rp) => rp.permission.key).sort()).toEqual([p1.key, p2.key].sort());
  });

  it("replaces a role's permission set on update", async () => {
    const p1 = await prisma.permission.create({ data: { key: `rbac.update.a.${suffix}` } });
    const p2 = await prisma.permission.create({ data: { key: `rbac.update.b.${suffix}` } });
    permissionIds.push(p1.id, p2.id);

    const role = await createRole({ name: `RbacUpdateRole-${suffix}`, permissionIds: [p1.id] });
    roleIds.push(role.id);

    const updated = await updateRole(role.id, { name: "Renamed Role", permissionIds: [p2.id] });
    expect(updated.name).toBe("Renamed Role");
    expect(updated.rolePermissions.map((rp) => rp.permissionId)).toEqual([p2.id]);
  });

  it("404s updating an unknown role", async () => {
    await expect(updateRole("00000000-0000-0000-0000-000000000000", { name: "X" })).rejects.toThrow(NotFoundError);
  });

  it("deletes an unassigned role, but blocks deleting one still assigned to a user", async () => {
    const deletable = await createRole({ name: `RbacDeletable-${suffix}`, permissionIds: [] });
    roleIds.push(deletable.id);
    await deleteRole(deletable.id);
    roleIds.splice(roleIds.indexOf(deletable.id), 1);

    const assigned = await createRole({ name: `RbacAssigned-${suffix}`, permissionIds: [] });
    roleIds.push(assigned.id);
    const user = await prisma.user.create({
      data: { phone: `+2010008${suffix}`, role: "staff", staffRoleId: assigned.id },
    });
    userIds.push(user.id);

    await expect(deleteRole(assigned.id)).rejects.toThrow(ConflictError);
  });

  it("userHasPermission reflects the assigned role's permission set", async () => {
    const permission = await prisma.permission.create({ data: { key: `rbac.check.${suffix}` } });
    permissionIds.push(permission.id);
    const role = await createRole({ name: `RbacCheckRole-${suffix}`, permissionIds: [permission.id] });
    roleIds.push(role.id);

    const user = await prisma.user.create({
      data: { phone: `+2010009${suffix}`, role: "staff", staffRoleId: role.id },
    });
    userIds.push(user.id);

    expect(await userHasPermission(user.id, permission.key)).toBe(true);
    expect(await userHasPermission(user.id, `rbac.nonexistent.${suffix}`)).toBe(false);

    const unassignedUser = await prisma.user.create({ data: { phone: `+2010010${suffix}`, role: "staff" } });
    userIds.push(unassignedUser.id);
    expect(await userHasPermission(unassignedUser.id, permission.key)).toBe(false);
  });
});
