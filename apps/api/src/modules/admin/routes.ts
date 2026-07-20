import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { listAllConfig, setConfigValue } from "../../shared/config.js";
import { listPayoutsQuerySchema, markPayoutPaidSchema, rejectPayoutSchema } from "../payouts/schemas.js";
import { approvePayout, listPayouts, markPayoutPaid, rejectPayout } from "../payouts/service.js";
import { createPromoSchema, updatePromoSchema } from "../promos/schemas.js";
import { createPromo, deletePromo, listPromos, updatePromo } from "../promos/service.js";
import { createPlanSchema, updatePlanSchema } from "../subscriptions/schemas.js";
import { createPlan, updatePlan } from "../subscriptions/service.js";
import { adjustOwe, listOweReport } from "../wallet/service.js";
import {
  adminListUsersQuerySchema,
  adminUpdateUserSchema,
  createStaffUserSchema,
  setUserStatusSchema,
} from "../users/schemas.js";
import { adminListUsers, adminUpdateUser, createStaffUser, setUserStatus } from "../users/service.js";
import {
  createVehicleTypeSchema,
  listVehiclesQuerySchema,
  updateVehicleSchema,
  updateVehicleTypeSchema,
} from "../vehicles/schemas.js";
import {
  createVehicleType,
  listAllVehicleTypes,
  listVehicles,
  updateVehicle,
  updateVehicleType,
} from "../vehicles/service.js";
import { listStatementsForAdmin } from "../drivers/service.js";
import { statementsQuerySchema } from "../drivers/schemas.js";
import { adminCancelTripSchema, adminListTripsQuerySchema, reassignTripSchema } from "../trips/schemas.js";
import { cancelTripAsAdmin } from "../trips/service.js";
import { reassignTripDriver } from "../dispatch/service.js";
import { prisma } from "../../db/index.js";
import {
  adjustOweSchema,
  heatmapQuerySchema,
  listDriversQuerySchema,
  rejectDriverSchema,
  roleInputSchema,
  sendBroadcastSchema,
  setConfigValueSchema,
  updateRoleSchema,
} from "./schemas.js";
import {
  adminListTrips,
  approveDriver,
  createRole,
  deleteRole,
  getDashboardStats,
  getDemandHeatmap,
  getDriverDocuments,
  getSupplyHeatmap,
  getTripDetailForAdmin,
  listActiveTripsForMap,
  listDrivers,
  listOnlineDrivers,
  listPermissions,
  listRoles,
  rejectDriver,
  sendBroadcast,
  updateRole,
} from "./service.js";

export const adminRouter = Router();

adminRouter.use(requireAuth);

/**
 * Two access tiers under one router (Phase 4.4):
 * - STAFF_ONLY: identity/compliance/config/RBAC — driver verification, staff
 *   & user management, vehicle-type/config editing, promos, subscription
 *   plans, roles & permissions. Stays admin/staff-exclusive.
 * - OPS_ROLES: day-to-day operations — dashboard, live map, trip
 *   management, payouts, owe, broadcasts, statements. The dispatcher panel
 *   needs all of these per docs/plan.md's Phase 4.4 feature list; fleet_owner
 *   does not get router-wide access (see /my-fleet below, a single
 *   fleet_owner-only endpoint instead of a parallel admin surface).
 */
const STAFF_ONLY = requireRole("admin", "staff");
const OPS_ROLES = requireRole("admin", "staff", "dispatcher");

adminRouter.get(
  "/drivers",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const { status } = listDriversQuerySchema.parse(req.query);
    const drivers = await listDrivers(status);
    res.json({ success: true, data: drivers });
  }),
);

adminRouter.post(
  "/drivers/:id/approve",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const driver = await approveDriver(req.params.id as string);
    res.json({ success: true, data: driver });
  }),
);

adminRouter.post(
  "/drivers/:id/reject",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const { reason } = rejectDriverSchema.parse(req.body);
    const driver = await rejectDriver(req.params.id as string, reason);
    res.json({ success: true, data: driver });
  }),
);

adminRouter.post(
  "/subscriptions/plans",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = createPlanSchema.parse(req.body);
    const plan = await createPlan(data);
    res.status(201).json({ success: true, data: plan });
  }),
);

adminRouter.patch(
  "/subscriptions/plans/:id",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = updatePlanSchema.parse(req.body);
    const plan = await updatePlan(req.params.id as string, data);
    res.json({ success: true, data: plan });
  }),
);

adminRouter.get(
  "/payouts",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const { status } = listPayoutsQuerySchema.parse(req.query);
    const payouts = await listPayouts(status);
    res.json({ success: true, data: { payouts } });
  }),
);

adminRouter.post(
  "/payouts/:id/approve",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const payout = await approvePayout(req.params.id as string, req.user!.id);
    res.json({ success: true, data: payout });
  }),
);

adminRouter.post(
  "/payouts/:id/reject",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const { reason } = rejectPayoutSchema.parse(req.body);
    const payout = await rejectPayout(req.params.id as string, req.user!.id, reason);
    res.json({ success: true, data: payout });
  }),
);

adminRouter.post(
  "/payouts/:id/paid",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const { method } = markPayoutPaidSchema.parse(req.body);
    const payout = await markPayoutPaid(req.params.id as string, req.user!.id, method);
    res.json({ success: true, data: payout });
  }),
);

adminRouter.get(
  "/promos",
  STAFF_ONLY,
  asyncHandler(async (_req, res) => {
    const promos = await listPromos();
    res.json({ success: true, data: { promos } });
  }),
);

adminRouter.post(
  "/promos",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = createPromoSchema.parse(req.body);
    const promo = await createPromo(data);
    res.status(201).json({ success: true, data: promo });
  }),
);

adminRouter.patch(
  "/promos/:id",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = updatePromoSchema.parse(req.body);
    const promo = await updatePromo(req.params.id as string, data);
    res.json({ success: true, data: promo });
  }),
);

adminRouter.delete(
  "/promos/:id",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    await deletePromo(req.params.id as string);
    res.json({ success: true, data: { deleted: true } });
  }),
);

adminRouter.get(
  "/owe",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const report = await listOweReport();
    res.json({ success: true, data: { report } });
  }),
);

adminRouter.post(
  "/owe/:driverId/adjust",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const { delta, reason } = adjustOweSchema.parse(req.body);
    await adjustOwe(req.params.driverId as string, delta, reason, req.user!.id);
    res.json({ success: true, data: { adjusted: true } });
  }),
);

adminRouter.post(
  "/broadcasts",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const data = sendBroadcastSchema.parse(req.body);
    const result = await sendBroadcast(req.user!.id, data);
    res.status(201).json({ success: true, data: result });
  }),
);

adminRouter.get(
  "/dashboard",
  OPS_ROLES,
  asyncHandler(async (_req, res) => {
    const stats = await getDashboardStats();
    res.json({ success: true, data: stats });
  }),
);

adminRouter.get(
  "/drivers/:id/documents",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const documents = await getDriverDocuments(req.params.id as string);
    res.json({ success: true, data: { documents } });
  }),
);

adminRouter.get(
  "/users",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const query = adminListUsersQuerySchema.parse(req.query);
    const users = await adminListUsers(query);
    res.json({ success: true, data: { users } });
  }),
);

adminRouter.post(
  "/users",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = createStaffUserSchema.parse(req.body);
    const user = await createStaffUser(req.user!.id, data);
    res.status(201).json({ success: true, data: user });
  }),
);

adminRouter.patch(
  "/users/:id",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = adminUpdateUserSchema.parse(req.body);
    const user = await adminUpdateUser(req.user!.id, req.params.id as string, data);
    res.json({ success: true, data: user });
  }),
);

adminRouter.post(
  "/users/:id/status",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const { status } = setUserStatusSchema.parse(req.body);
    const user = await setUserStatus(req.user!.id, req.params.id as string, status);
    res.json({ success: true, data: user });
  }),
);

adminRouter.get(
  "/vehicle-types",
  STAFF_ONLY,
  asyncHandler(async (_req, res) => {
    const types = await listAllVehicleTypes();
    res.json({ success: true, data: { types } });
  }),
);

adminRouter.post(
  "/vehicle-types",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = createVehicleTypeSchema.parse(req.body);
    const type = await createVehicleType(data);
    res.status(201).json({ success: true, data: type });
  }),
);

adminRouter.patch(
  "/vehicle-types/:id",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = updateVehicleTypeSchema.parse(req.body);
    const type = await updateVehicleType(req.params.id as string, data);
    res.json({ success: true, data: type });
  }),
);

adminRouter.get(
  "/vehicles",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const query = listVehiclesQuerySchema.parse(req.query);
    const vehicles = await listVehicles(query);
    res.json({ success: true, data: { vehicles } });
  }),
);

adminRouter.patch(
  "/vehicles/:id",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = updateVehicleSchema.parse(req.body);
    const vehicle = await updateVehicle(req.params.id as string, data);
    res.json({ success: true, data: vehicle });
  }),
);

adminRouter.get(
  "/config",
  STAFF_ONLY,
  asyncHandler(async (_req, res) => {
    const config = await listAllConfig();
    res.json({ success: true, data: { config } });
  }),
);

adminRouter.patch(
  "/config/:key",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const { value } = setConfigValueSchema.parse(req.body);
    const row = await setConfigValue(req.params.key as string, value);
    res.json({ success: true, data: row });
  }),
);

adminRouter.get(
  "/permissions",
  STAFF_ONLY,
  asyncHandler(async (_req, res) => {
    const permissions = await listPermissions();
    res.json({ success: true, data: { permissions } });
  }),
);

adminRouter.get(
  "/roles",
  STAFF_ONLY,
  asyncHandler(async (_req, res) => {
    const roles = await listRoles();
    res.json({ success: true, data: { roles } });
  }),
);

adminRouter.post(
  "/roles",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = roleInputSchema.parse(req.body);
    const role = await createRole(data);
    res.status(201).json({ success: true, data: role });
  }),
);

adminRouter.patch(
  "/roles/:id",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    const data = updateRoleSchema.parse(req.body);
    const role = await updateRole(req.params.id as string, data);
    res.json({ success: true, data: role });
  }),
);

adminRouter.delete(
  "/roles/:id",
  STAFF_ONLY,
  asyncHandler(async (req, res) => {
    await deleteRole(req.params.id as string);
    res.json({ success: true, data: { deleted: true } });
  }),
);

adminRouter.get(
  "/live/drivers",
  OPS_ROLES,
  asyncHandler(async (_req, res) => {
    const drivers = await listOnlineDrivers();
    res.json({ success: true, data: { drivers } });
  }),
);

adminRouter.get(
  "/live/trips",
  OPS_ROLES,
  asyncHandler(async (_req, res) => {
    const trips = await listActiveTripsForMap();
    res.json({ success: true, data: { trips } });
  }),
);

adminRouter.get(
  "/trips",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const query = adminListTripsQuerySchema.parse(req.query);
    const trips = await adminListTrips(query);
    res.json({ success: true, data: { trips } });
  }),
);

adminRouter.get(
  "/trips/:id",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const trip = await getTripDetailForAdmin(req.params.id as string);
    res.json({ success: true, data: trip });
  }),
);

adminRouter.post(
  "/trips/:id/cancel",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const { reason } = adminCancelTripSchema.parse(req.body);
    const trip = await cancelTripAsAdmin(req.params.id as string, req.user!.id, reason);
    res.json({ success: true, data: trip });
  }),
);

adminRouter.post(
  "/trips/:id/reassign",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const { driverId } = reassignTripSchema.parse(req.body);
    const trip = await reassignTripDriver(req.params.id as string, driverId, req.user!.id);
    res.json({ success: true, data: trip });
  }),
);

adminRouter.get(
  "/heatmap/demand",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const { from, to } = heatmapQuerySchema.parse(req.query);
    const points = await getDemandHeatmap(from, to);
    res.json({ success: true, data: { points } });
  }),
);

adminRouter.get(
  "/heatmap/supply",
  OPS_ROLES,
  asyncHandler(async (_req, res) => {
    const points = await getSupplyHeatmap();
    res.json({ success: true, data: { points } });
  }),
);

adminRouter.get(
  "/statements",
  OPS_ROLES,
  asyncHandler(async (req, res) => {
    const { driverId } = statementsQuerySchema.parse(req.query);
    const statements = await listStatementsForAdmin(driverId);
    res.json({ success: true, data: { statements } });
  }),
);

/**
 * Company panel (Phase 4.4): a single fleet_owner-scoped endpoint rather
 * than a parallel admin surface — a fleet owner sees only their own
 * vehicles and drivers (Vehicle.fleetOwnerId / DriverProfile.fleetOwnerId,
 * present in the schema since Phase 0 but unused until now), read-only.
 * Platform financial operations (payouts, owe adjustments) stay
 * dispatcher/admin-only — a fleet owner doesn't control money the platform
 * owes its drivers.
 */
adminRouter.get(
  "/my-fleet",
  requireRole("fleet_owner"),
  asyncHandler(async (req, res) => {
    const [vehicles, drivers] = await Promise.all([
      prisma.vehicle.findMany({
        where: { fleetOwnerId: req.user!.id },
        include: { vehicleType: true, currentDriver: { include: { user: { select: { name: true, phone: true } } } } },
      }),
      prisma.driverProfile.findMany({
        where: { fleetOwnerId: req.user!.id },
        include: { user: { select: { name: true, phone: true } }, currentVehicle: { include: { vehicleType: true } } },
      }),
    ]);
    res.json({ success: true, data: { vehicles, drivers } });
  }),
);
