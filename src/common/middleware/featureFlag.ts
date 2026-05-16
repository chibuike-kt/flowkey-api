import type { Request, Response, NextFunction } from 'express';
import { isEnabled, type FeatureFlag } from '../feature-flags/index';
import { AppError, ErrorCode } from '../errors/AppError';

export function requireFlag(flag: FeatureFlag) {
  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const enabled = await isEnabled(flag);
      if (!enabled) {
        // Return 404 — don't reveal the feature exists but is disabled
        next(new AppError(ErrorCode.NOT_FOUND, 'Not found.'));
        return;
      }
      next();
    } catch (err) {
      // Flag check failed — fail open (allow the request through)
      // Better to serve a request than to block all users on a Redis hiccup
      next();
    }
  };
}
