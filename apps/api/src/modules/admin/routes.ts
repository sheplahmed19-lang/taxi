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

adminRouter.use(requireAuth, requireRole("admin", "staff"));

adminRouter.get(
  "/drivers",
  asyncHandler(async (req, res) => {
    const { status } = listDriversQuerySchema.parse(req.query);
    const drivers = await listDrivers(status);
    res.json({ success: true, data: drivers });
  }),
);

adminRouter.post(
  "/drivers/:id/approve",
  asyncHandler(async (req, res) => {
    const driver = await approveDriver(req.params.id as string);
    res.json({ success: true, data: driver });
  }),
);

adminRouter.post(
  "/drivers/:id/reject",
  asyncHandler(async (req, res) => {
    const { reason } = rejectDriverSchema.parse(req.body);
    const driver = await rejectDriver(req.params.id as string, reason);
    res.json({ success: true, data: driver });
  }),
);

adminRouter.post(
  "/subscriptions/plans",
  asyncHandler(async (req, res) => {
    const data = createPlanSchema.parse(req.body);
    const plan = await createPlan(data);
    res.status(201).json({ success: true, data: plan });
  }),
);

adminRouter.patch(
  "/subscriptions/plans/:id",
  asyncHandler(async (req, res) => {
    const data = updatePlanSchema.parse(req.body);
    const plan = await updatePlan(req.params.id as string, data);
    res.json({ success: true, data: plan });
  }),
);

adminRouter.get(
  "/payouts",
  asyncHandler(async (req, res) => {
    const { status } = listPayoutsQuerySchema.parse(req.query);
    const payouts = await listPayouts(status);
    res.json({ success: true, data: { payouts } });
  }),
);

adminRouter.post(
  "/payouts/:id/approve",
  asyncHandler(async (req, res) => {
    const payout = await approvePayout(req.params.id as string, req.user!.id);
    res.json({ success: true, data: payout });
  }),
);

adminRouter.post(
  "/payouts/:id/reject",
  asyncHandler(async (req, res) => {
    const { reason } = rejectPayoutSchema.parse(req.body);
    const payout = await rejectPayout(req.params.id as string, req.user!.id, reason);
    res.json({ success: true, data: payout });
  }),
);

adminRouter.post(
  "/payouts/:id/paid",
  asyncHandler(async (req, res) => {
    const { method } = markPayoutPaidSchema.parse(req.body);
    const payout = await markPayoutPaid(req.params.id as string, req.user!.id, method);
    res.json({ success: true, data: payout });
  }),
);

adminRouter.get(
  "/promos",
  asyncHandler(async (_req, res) => {
    const promos = await listPromos();
    res.json({ success: true, data: { promos } });
  }),
);

adminRouter.post(
  "/promos",
  asyncHandler(async (req, res) => {
    const data = createPromoSchema.parse(req.body);
    const promo = await createPromo(data);
    res.status(201).json({ success: true, data: promo });
  }),
);

adminRouter.patch(
  "/promos/:id",
  asyncHandler(async (req, res) => {
    const data = updatePromoSchema.parse(req.body);
    const promo = await updatePromo(req.params.id as string, data);
    res.json({ success: true, data: promo });
  }),
);

adminRouter.delete(
  "/promos/:id",
  asyncHandler(async (req, res) => {
    await deletePromo(req.params.id as string);
    res.json({ success: true, data: { deleted: true } });
  }),
);

adminRouter.get(
  "/owe",
  asyncHandler(async (req, res) => {
    const report = await listOweReport();
    res.json({ success: true, data: { report } });
  }),
);

adminRouter.post(
  "/owe/:driverId/adjust",
  asyncHandler(async (req, res) => {
    const { delta, reason } = adjustOweSchema.parse(req.body);
    await adjustOwe(req.params.driverId as string, delta, reason, req.user!.id);
    res.json({ success: true, data: { adjusted: true } });
  }),
);

adminRouter.post(
  "/broadcasts",
  asyncHandler(async (req, res) => {
    const data = sendBroadcastSchema.parse(req.body);
    const result = await sendBroadcast(req.user!.id, data);
    res.status(201).json({ success: true, data: result });
  }),
);

adminRouter.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const stats = await getDashboardStats();
    res.json({ success: true, data: stats });
  }),
);

adminRouter.get(
  "/drivers/:id/documents",
  asyncHandler(async (req, res) => {
    const documents = await getDriverDocuments(req.params.id as string);
    res.json({ success: true, data: { documents } });
  }),
);

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const query = adminListUsersQuerySchema.parse(req.query);
    const users = await adminListUsers(query);
    res.json({ success: true, data: { users } });
  }),
);

adminRouter.post(
  "/users",
  asyncHandler(async (req, res) => {
    const data = createStaffUserSchema.parse(req.body);
    const user = await createStaffUser(req.user!.id, data);
    res.status(201).json({ success: true, data: user });
  }),
);

adminRouter.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const data = adminUpdateUserSchema.parse(req.body);
    const user = await adminUpdateUser(req.user!.id, req.params.id as string, data);
    res.json({ success: true, data: user });
  }),
);

adminRouter.post(
  "/users/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = setUserStatusSchema.parse(req.body);
    const user = await setUserStatus(req.user!.id, req.params.id as string, status);
    res.json({ success: true, data: user });
  }),
);

adminRouter.get(
  "/vehicle-types",
  asyncHandler(async (_req, res) => {
    const types = await listAllVehicleTypes();
    res.json({ success: true, data: { types } });
  }),
);

adminRouter.post(
  "/vehicle-types",
  asyncHandler(async (req, res) => {
    const data = createVehicleTypeSchema.parse(req.body);
    const type = await createVehicleType(data);
    res.status(201).json({ success: true, data: type });
  }),
);

adminRouter.patch(
  "/vehicle-types/:id",
  asyncHandler(async (req, res) => {
    const data = updateVehicleTypeSchema.parse(req.body);
    const type = await updateVehicleType(req.params.id as string, data);
    res.json({ success: true, data: type });
  }),
);

adminRouter.get(
  "/vehicles",
  asyncHandler(async (req, res) => {
    const query = listVehiclesQuerySchema.parse(req.query);
    const vehicles = await listVehicles(query);
    res.json({ success: true, data: { vehicles } });
  }),
);

adminRouter.patch(
  "/vehicles/:id",
  asyncHandler(async (req, res) => {
    const data = updateVehicleSchema.parse(req.body);
    const vehicle = await updateVehicle(req.params.id as string, data);
    res.json({ success: true, data: vehicle });
  }),
);

adminRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    const config = await listAllConfig();
    res.json({ success: true, data: { config } });
  }),
);

adminRouter.patch(
  "/config/:key",
  asyncHandler(async (req, res) => {
    const { value } = setConfigValueSchema.parse(req.body);
    const row = await setConfigValue(req.params.key as string, value);
    res.json({ success: true, data: row });
  }),
);

adminRouter.get(
  "/permissions",
  asyncHandler(async (_req, res) => {
    const permissions = await listPermissions();
    res.json({ success: true, data: { permissions } });
  }),
);

adminRouter.get(
  "/roles",
  asyncHandler(async (_req, res) => {
    const roles = await listRoles();
    res.json({ success: true, data: { roles } });
  }),
);

adminRouter.post(
  "/roles",
  asyncHandler(async (req, res) => {
    const data = roleInputSchema.parse(req.body);
    const role = await createRole(data);
    res.status(201).json({ success: true, data: role });
  }),
);

adminRouter.patch(
  "/roles/:id",
  asyncHandler(async (req, res) => {
    const data = updateRoleSchema.parse(req.body);
    const role = await updateRole(req.params.id as string, data);
    res.json({ success: true, data: role });
  }),
);

adminRouter.delete(
  "/roles/:id",
  asyncHandler(async (req, res) => {
    await deleteRole(req.params.id as string);
    res.json({ success: true, data: { deleted: true } });
  }),
);

adminRouter.get(
  "/live/drivers",
  asyncHandler(async (_req, res) => {
    const drivers = await listOnlineDrivers();
    res.json({ success: true, data: { drivers } });
  }),
);

adminRouter.get(
  "/live/trips",
  asyncHandler(async (_req, res) => {
    const trips = await listActiveTripsForMap();
    res.json({ success: true, data: { trips } });
  }),
);

adminRouter.get(
  "/trips/:id",
  asyncHandler(async (req, res) => {
    const trip = await getTripDetailForAdmin(req.params.id as string);
    res.json({ success: true, data: trip });
  }),
);

adminRouter.get(
  "/heatmap/demand",
  asyncHandler(async (req, res) => {
    const { from, to } = heatmapQuerySchema.parse(req.query);
    const points = await getDemandHeatmap(from, to);
    res.json({ success: true, data: { points } });
  }),
);

adminRouter.get(
  "/heatmap/supply",
  asyncHandler(async (_req, res) => {
    const points = await getSupplyHeatmap();
    res.json({ success: true, data: { points } });
  }),
);
