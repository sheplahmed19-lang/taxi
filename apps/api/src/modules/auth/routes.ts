import { Router } from "express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { UnauthorizedError, ValidationError } from "../../shared/errors.js";
import { otpRequestSchema, otpVerifySchema, refreshSchema, staffLoginSchema } from "./schemas.js";
import { requestOtp, verifyOtp } from "./otp.js";
import { findOrCreateUserByPhone, authenticateStaff, toAuthUser } from "./service.js";
import { issueRefreshToken, rotateRefreshToken, signAccessToken } from "./tokens.js";

export const authRouter = Router();

authRouter.post(
  "/otp/request",
  asyncHandler(async (req, res) => {
    const { phone } = otpRequestSchema.parse(req.body);
    await requestOtp(phone);
    res.json({ success: true, data: { message: "OTP sent" } });
  }),
);

authRouter.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const { phone, otp, role, referralCode } = otpVerifySchema.parse(req.body);

    const valid = await verifyOtp(phone, otp);
    if (!valid) {
      throw new ValidationError("Invalid or expired OTP");
    }

    const user = await findOrCreateUserByPhone(phone, role, referralCode);
    const accessToken = signAccessToken(toAuthUser(user));
    const refreshToken = await issueRefreshToken(user.id);

    res.json({
      success: true,
      data: { user: { id: user.id, phone: user.phone, role: user.role }, accessToken, refreshToken },
    });
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);

    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    const accessToken = signAccessToken({ id: rotated.userId, role: rotated.role });

    res.json({
      success: true,
      data: { accessToken, refreshToken: rotated.token },
    });
  }),
);

authRouter.post(
  "/staff/login",
  asyncHandler(async (req, res) => {
    const { email, password } = staffLoginSchema.parse(req.body);

    const user = await authenticateStaff(email, password);
    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const accessToken = signAccessToken(toAuthUser(user));
    const refreshToken = await issueRefreshToken(user.id);

    res.json({
      success: true,
      data: { user: { id: user.id, email: user.email, role: user.role }, accessToken, refreshToken },
    });
  }),
);
