import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { updateZoneSchema, zoneInputSchema } from "./schemas.js";
import { createZone, deleteZone, listZones, updateZone } from "./service.js";

export const zonesRouter = Router();

zonesRouter.use(requireAuth, requireRole("admin", "staff", "dispatcher"));

zonesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const zones = await listZones();
    res.json({ success: true, data: { zones } });
  }),
);

zonesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = zoneInputSchema.parse(req.body);
    const zone = await createZone(data);
    res.status(201).json({ success: true, data: zone });
  }),
);

zonesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updateZoneSchema.parse(req.body);
    const zone = await updateZone(req.params.id as string, data);
    res.json({ success: true, data: zone });
  }),
);

zonesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteZone(req.params.id as string);
    res.json({ success: true, data: { deleted: true } });
  }),
);
