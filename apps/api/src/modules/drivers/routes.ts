import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { upload } from "../../middleware/upload.js";
import { ValidationError } from "../../shared/errors.js";
import { getOwe, payOweFromWallet } from "../wallet/service.js";
import {
  nearbyDriversQuerySchema,
  registerDriverSchema,
  setAvailabilitySchema,
  uploadDocumentSchema,
} from "./schemas.js";
import {
  findNearbyDrivers,
  getDriverProfile,
  listMyStatements,
  registerDriver,
  setAvailability,
  uploadDriverDocument,
} from "./service.js";

export const driversRouter = Router();

driversRouter.use(requireAuth);

// Open to any authenticated role — the rider app map calls this too.
driversRouter.get(
  "/nearby",
  asyncHandler(async (req, res) => {
    const { lat, lng, vehicleTypeId, radiusKm } = nearbyDriversQuerySchema.parse(req.query);
    const drivers = await findNearbyDrivers({ lat, lng }, vehicleTypeId, radiusKm);
    res.json({ success: true, data: { drivers } });
  }),
);

driversRouter.use(requireRole("driver"));

driversRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const profile = await getDriverProfile(req.user!.id);
    res.json({ success: true, data: profile });
  }),
);

driversRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const data = registerDriverSchema.parse(req.body);
    const profile = await registerDriver(req.user!.id, data);
    res.status(201).json({ success: true, data: profile });
  }),
);

driversRouter.post(
  "/documents",
  upload.single("document"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Missing document file");
    }
    const { type } = uploadDocumentSchema.parse(req.body);
    const profile = await uploadDriverDocument(req.user!.id, type, req.file);
    res.json({ success: true, data: profile });
  }),
);

driversRouter.post(
  "/availability",
  asyncHandler(async (req, res) => {
    const { online } = setAvailabilitySchema.parse(req.body);
    const profile = await setAvailability(req.user!.id, online);
    res.json({ success: true, data: profile });
  }),
);

driversRouter.get(
  "/owe",
  asyncHandler(async (req, res) => {
    const owe = await getOwe(req.user!.id);
    res.json({ success: true, data: owe });
  }),
);

driversRouter.post(
  "/owe/pay",
  asyncHandler(async (req, res) => {
    await payOweFromWallet(req.user!.id);
    res.json({ success: true, data: { paid: true } });
  }),
);

driversRouter.get(
  "/statements",
  asyncHandler(async (req, res) => {
    const statements = await listMyStatements(req.user!.id);
    res.json({ success: true, data: { statements } });
  }),
);
