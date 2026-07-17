import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Wraps an async route handler so rejected promises reach errorHandler (Express 4 doesn't do this natively). */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
