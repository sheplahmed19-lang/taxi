import type { NextFunction, Request, Response } from "express";
import { AppError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
}
