import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, verifyAdminAccessToken } from '../../features/auth/token.service';
import { isSessionBlocklisted } from '../../features/auth/session.service';
import { AppError, ErrorCode } from '../errors/AppError';

// ---------------------------------------------------------------------------
// User auth middleware
// ---------------------------------------------------------------------------

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Authentication required. Please log in.');
    }

    const token = authHeader.slice(7); // strip 'Bearer '
    const payload = verifyAccessToken(token);

    // Check session blocklist — handles revoked sessions within the TTL window
    const blocklisted = await isSessionBlocklisted(payload.session_id);
    if (blocklisted) {
      throw new AppError(
        ErrorCode.SESSION_REVOKED,
        'This session has been revoked. Please log in again.',
      );
    }

    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Admin auth middleware
// ---------------------------------------------------------------------------

export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Admin authentication required.');
    }

    const token = authHeader.slice(7);
    const payload = verifyAdminAccessToken(token);

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      throw new AppError(ErrorCode.FORBIDDEN, 'Admin access required.');
    }

    // Store admin payload on req.user — sub is admin_id in this context
    req.user = {
      sub: payload.sub,
      session_id: payload.session_id,
      device_id: payload.device_id,
      tier: 0,
      iat: payload.iat,
      exp: payload.exp,
      iss: payload.iss,
      aud: payload.aud,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export async function requireSuperAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Admin authentication required.');
    }

    const token = authHeader.slice(7);
    const payload = verifyAdminAccessToken(token);

    if (payload.role !== 'super_admin') {
      throw new AppError(ErrorCode.FORBIDDEN, 'Super admin access required for this action.');
    }

    req.user = {
      sub: payload.sub,
      session_id: payload.session_id,
      device_id: payload.device_id,
      tier: 0,
      iat: payload.iat,
      exp: payload.exp,
      iss: payload.iss,
      aud: payload.aud,
    };

    next();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// KYC tier gate
// ---------------------------------------------------------------------------

/**
 * Factory: returns middleware that enforces a minimum KYC tier.
 * Must be used after requireAuth.
 */
export function requireKycTier(minimumTier: number) {
  return function kycTierGuard(req: Request, _res: Response, next: NextFunction): void {
    if (!req.user) {
      next(new AppError(ErrorCode.UNAUTHORIZED, 'Authentication required.'));
      return;
    }

    if (req.user.tier < minimumTier) {
      next(
        new AppError(
          ErrorCode.KYC_TIER_INSUFFICIENT,
          `This action requires KYC Tier ${minimumTier} or higher. ` +
            `Your current tier is ${req.user.tier}. ` +
            `Please complete identity verification to continue.`,
        ),
      );
      return;
    }

    next();
  };
}
