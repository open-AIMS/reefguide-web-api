import { NextFunction, Request, Response } from "express";
import { BaseApiException } from "./exceptions";
import { ErrorResponse } from "../interfaces/Errors";

/**
 * Error middleware to handle custom API exceptions.
 * Extracts status code and message from the exception and returns a JSON error response.
 */
export function errorMiddleware(
  err: Error,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) {
  // Only print out logs for errors if not testing
  if (process.env.TEST_MODE !== "true") {
    console.error(err);
  }

  let statusCode = 500;
  let message = "An unexpected error occurred";

  if (err instanceof BaseApiException) {
    statusCode = err.statusCode;
    message = err.message;
  }

  const errorResponse: ErrorResponse = {
    status: statusCode,
    message: message,
  };

  res.status(statusCode).json(errorResponse);
}
