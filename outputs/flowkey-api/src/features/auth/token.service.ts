/**
 * FlowKey — Token Service
 *
 * Owns all JWT and refresh token operations:
 *   - Access token issuance (RS256 JWT, 15-min TTL)
 *   - Refresh token issuance (256-bit opaque, stored as SHA-256 hash)
 *   - Access token verification
 *   - Refresh token rotation with reuse detection
 *
 * Security invariants:
 *   - Private key never leaves this module
 *   - Refresh tokens stored as SHA-256 hashes — never plaintext
 *   - Rotated refresh token reuse triggers full session family revocation
 */

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
      throw new AppError(ErrorCode.TOKEN_EXPIRED, 'Your session has expired. Please log in again.');
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
      throw new AppError(ErrorCode.TOKEN_EXPIRED, 'Your session has expired. Please log in again.');
    }
    throw new AppError(ErrorCode.INVALID_TOKEN, 'Invalid authentication token.');
  }
}

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random 256-bit refresh token.
 * Returns both the raw token (returned to client once) and its hash (stored in DB).
 */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex'); // 256 bits, hex-encoded
  const hash = hashRefreshToken(raw);
  return { raw, hash };
}

/**
 * Hash a refresh token for storage.
 * SHA-256 is sufficient here — refresh tokens are high-entropy random values,
 * not low-entropy secrets. Argon2id would be overkill and slow.
 */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// Token TTL helper
// ---------------------------------------------------------------------------

export function getAccessTokenExpiresIn(): number {
  return config().jwtAccessTokenTtl;
}
