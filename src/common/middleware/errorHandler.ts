
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ErrorCode } from '../errors/AppError';
import { errorResponse } from '../types/api';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // --- AppError (known operational error) ---
  if (AppError.isAppError(err)) {
    res.status(err.httpStatus).json(errorResponse(err.code, err.message));
    return;
  }

  // --- Zod validation error ---
  if (err instanceof ZodError) {
    const firstIssue = err.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join('.')} — ${firstIssue.message}`
      : 'Invalid request data';

    res.status(422).json(errorResponse(ErrorCode.VALIDATION_ERROR, message));
    return;
  }

  // --- Unknown error (programming error / unexpected) ---
  // CRITICAL: never expose internal error details to the client
  console.error('[ErrorHandler] Unhandled error:', err);

  res
    .status(500)
    .json(
      errorResponse(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'An unexpected error occurred. Please try again later.',
      ),
    );
}
