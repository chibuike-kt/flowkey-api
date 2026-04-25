import type { Request, Response } from 'express';
import { ErrorCode } from '../errors/AppError';
import { errorResponse } from '../types/api';

export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json(errorResponse(ErrorCode.NOT_FOUND, `Route ${req.method} ${req.path} does not exist.`));
}
