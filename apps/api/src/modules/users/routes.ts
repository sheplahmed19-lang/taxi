import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { upload } from "../../middleware/upload.js";
import { ValidationError } from "../../shared/errors.js";
import {
  createFavoriteSchema,
  listNotificationsQuerySchema,
  registerDeviceTokenSchema,
  updateFavoriteSchema,
  updateProfileSchema,
} from "./schemas.js";
import {
  createFavorite,
  deleteFavorite,
  getProfile,
  listFavorites,
  registerDeviceToken,
  updateAvatar,
  updateFavorite,
  updateProfile,
} from "./service.js";
import { listForUser } from "../notifications/service.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const profile = await getProfile(req.user!.id);
    res.json({ success: true, data: profile });
  }),
);

usersRouter.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const data = updateProfileSchema.parse(req.body);
    const profile = await updateProfile(req.user!.id, data);
    res.json({ success: true, data: profile });
  }),
);

usersRouter.post(
  "/me/avatar",
  upload.single("avatar"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Missing avatar file");
    }
    const profile = await updateAvatar(req.user!.id, req.file);
    res.json({ success: true, data: profile });
  }),
);

usersRouter.get(
  "/me/favorites",
  asyncHandler(async (req, res) => {
    const favorites = await listFavorites(req.user!.id);
    res.json({ success: true, data: favorites });
  }),
);

usersRouter.post(
  "/me/favorites",
  asyncHandler(async (req, res) => {
    const data = createFavoriteSchema.parse(req.body);
    const favorite = await createFavorite(req.user!.id, data);
    res.status(201).json({ success: true, data: favorite });
  }),
);

usersRouter.patch(
  "/me/favorites/:id",
  asyncHandler(async (req, res) => {
    const data = updateFavoriteSchema.parse(req.body);
    const favorite = await updateFavorite(req.user!.id, req.params.id as string, data);
    res.json({ success: true, data: favorite });
  }),
);

usersRouter.delete(
  "/me/favorites/:id",
  asyncHandler(async (req, res) => {
    await deleteFavorite(req.user!.id, req.params.id as string);
    res.status(204).send();
  }),
);

usersRouter.get(
  "/me/notifications",
  asyncHandler(async (req, res) => {
    const { cursor } = listNotificationsQuerySchema.parse(req.query);
    const notifications = await listForUser(req.user!.id, cursor);
    res.json({ success: true, data: notifications });
  }),
);

usersRouter.post(
  "/me/device-tokens",
  asyncHandler(async (req, res) => {
    const { token, platform } = registerDeviceTokenSchema.parse(req.body);
    const deviceToken = await registerDeviceToken(req.user!.id, token, platform);
    res.status(201).json({ success: true, data: deviceToken });
  }),
);
