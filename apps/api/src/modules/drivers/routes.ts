import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { upload } from "../../middleware/upload.js";
import { ValidationError } from "../../shared/errors.js";
import { registerDriverSchema, uploadDocumentSchema } from "./schemas.js";
import { getDriverProfile, registerDriver, uploadDriverDocument } from "./service.js";

export const driversRouter = Router();

driversRouter.use(requireAuth, requireRole("driver"));

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
