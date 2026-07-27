import { prisma } from "./index.js";

/**
 * Phase 0.2 seed: 1 admin, 3 vehicle types, default system_config values,
 * 1 test zone polygon. Phase 4.2 adds: permissions + a Super Admin StaffRole
 * (all permissions) assigned to the seeded admin. Safe to re-run (upserts /
 * existence checks).
 */
async function main(): Promise<void> {
  const admin = await prisma.user.upsert({
    where: { phone: "+201000000000" },
    update: {},
    create: {
      phone: "+201000000000",
      email: "admin@rideplatform.dev",
      name: "Platform Admin",
      role: "admin",
      status: "active",
    },
  });

  // Money fields are integer minor units (piastres). See shared/money.ts.
  const vehicleTypes = [
    {
      name: "Economy",
      icon: "car-economy",
      seats: 4,
      baseFare: 500,
      perKm: 150,
      perMin: 20,
      minFare: 1000,
      nightMultiplier: 1.25,
      nightStart: "22:00",
      nightEnd: "06:00",
    },
    {
      name: "Comfort",
      icon: "car-comfort",
      seats: 4,
      baseFare: 800,
      perKm: 200,
      perMin: 30,
      minFare: 1500,
      nightMultiplier: 1.25,
      nightStart: "22:00",
      nightEnd: "06:00",
    },
    {
      name: "XL",
      icon: "car-xl",
      seats: 6,
      baseFare: 1200,
      perKm: 280,
      perMin: 40,
      minFare: 2000,
      nightMultiplier: 1.25,
      nightStart: "22:00",
      nightEnd: "06:00",
    },
  ];

  for (const vt of vehicleTypes) {
    await prisma.vehicleType.upsert({
      where: { name: vt.name },
      update: vt,
      create: vt,
    });
  }

  const systemConfig: Array<{ key: string; value: unknown }> = [
    { key: "dispatch_radius_km", value: 5 },
    { key: "dispatch_timeout_s", value: 15 },
    { key: "otp_length", value: 4 },
    { key: "commission_pct", value: 20 },
    { key: "cancellation_fee", value: 500 },
    { key: "owe_block_threshold", value: 10000 },
    { key: "referral_bonus_rider", value: 500 },
    { key: "referral_bonus_driver", value: 1000 },
    { key: "scheduled_reminder_minutes", value: 60 },
    { key: "scheduled_dispatch_lead_minutes", value: 15 },
    { key: "share_link_ttl_hours", value: 24 },
    { key: "max_plausible_speed_kmh", value: 180 },
  ];

  for (const cfg of systemConfig) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: { value: cfg.value as never },
      create: { key: cfg.key, value: cfg.value as never },
    });
  }

  const existingZone = await prisma.zone.findFirst({ where: { name: "Test Zone — Downtown" } });
  if (!existingZone) {
    const zone = await prisma.zone.create({
      data: { name: "Test Zone — Downtown", fareOverrides: {}, active: true },
    });
    await prisma.$executeRaw`
      UPDATE zones
      SET polygon = ST_GeomFromText(
        'POLYGON((31.20 30.02, 31.25 30.02, 31.25 30.07, 31.20 30.07, 31.20 30.02))',
        4326
      )
      WHERE id = ${zone.id}
    `;
  }

  const permissionKeys = [
    "drivers.manage",
    "users.manage",
    "vehicles.manage",
    "config.manage",
    "payouts.manage",
    "promos.manage",
    "broadcasts.send",
    "roles.manage",
  ];

  const permissions = await Promise.all(
    permissionKeys.map((key) =>
      prisma.permission.upsert({ where: { key }, update: {}, create: { key } }),
    ),
  );

  const superAdminRole = await prisma.staffRole.upsert({
    where: { name: "Super Admin" },
    update: {},
    create: { name: "Super Admin", description: "Full access to all admin panel functions" },
  });

  await Promise.all(
    permissions.map((permission) =>
      prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: superAdminRole.id, permissionId: permission.id } },
        update: {},
        create: { roleId: superAdminRole.id, permissionId: permission.id },
      }),
    ),
  );

  await prisma.user.update({
    where: { id: admin.id },
    data: { staffRoleId: superAdminRole.id },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
