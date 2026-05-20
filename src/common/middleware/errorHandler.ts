import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { logger } from '../utils/logger';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({
      success: false,
      data: null,
      meta: null,
      error: { code: err.code, message: err.message },
    });
    return;
  }
  logger.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({
    success: false,
    data: null,
    meta: null,
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
  });
}
