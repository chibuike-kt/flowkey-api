import * as jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import { config } from '../../config';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import type { AccessTokenPayload, AdminAccessTokenPayload } from './auth.types';

// ---------------------------------------------------------------------------
// Access token
// ---------------------------------------------------------------------------

export function issueAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): string {
  const cfg = config();
  const { iss: _iss, aud: _aud, ...jwtPayload } = payload;
  return jwt.sign(jwtPayload, cfg.jwtPrivateKey, {
    algorithm: 'RS256',
    expiresIn: cfg.jwtAccessTokenTtl,
    issuer: cfg.jwtIssuer,
    audience: cfg.jwtAudience,
  });
}

export function issueAdminAccessToken(
  payload: Omit<AdminAccessTokenPayload, 'iat' | 'exp'>,
): string {
  const cfg = config();
  const { iss: _iss, aud: _aud, ...jwtPayload } = payload;
  return jwt.sign(jwtPayload, cfg.jwtPrivateKey, {
    algorithm: 'RS256',
    expiresIn: cfg.jwtAccessTokenTtl,
    issuer: cfg.jwtIssuer,
    audience: cfg.jwtAudience,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const cfg = config();
  try {
    return jwt.verify(token, cfg.jwtPublicKey, {
      algorithms: ['RS256'],
      issuer: cfg.jwtIssuer,
      audience: cfg.jwtAudience,
    }) as AccessTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(
        ErrorCode.TOKEN_EXPIRED,
        'Access token expired. Please refresh your session.',
      );
    }
    throw new AppError(ErrorCode.INVALID_TOKEN, 'Invalid authentication token.');
  }
}

export function verifyAdminAccessToken(token: string): AdminAccessTokenPayload {
  const cfg = config();
  try {
    return jwt.verify(token, cfg.jwtPublicKey, {
      algorithms: ['RS256'],
      issuer: cfg.jwtIssuer,
      audience: cfg.jwtAudience,
    }) as AdminAccessTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(
        ErrorCode.TOKEN_EXPIRED,
        'Access token expired. Please refresh your session.',
      );
    }
    throw new AppError(ErrorCode.INVALID_TOKEN, 'Invalid authentication token.');
  }
}

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex'); // 256 bits, hex-encoded
  const hash = hashRefreshToken(raw);
  return { raw, hash };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// Token TTL helper
// ---------------------------------------------------------------------------

export function getAccessTokenExpiresIn(): number {
  return config().jwtAccessTokenTtl;
}
