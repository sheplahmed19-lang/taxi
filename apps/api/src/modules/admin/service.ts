// admin module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";

/** Checks whether a user's assigned StaffRole grants the given permission key. */
export async function userHasPermission(userId: string, permissionKey: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      staffRole: {
        select: {
          rolePermissions: {
            where: { permission: { key: permissionKey } },
            select: { roleId: true },
          },
        },
      },
    },
  });

  return Boolean(user?.staffRole && user.staffRole.rolePermissions.length > 0);
}
