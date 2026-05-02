import { config } from '../../config';
import { prisma } from '../../common/utils/prisma';
import { redis } from '../../common/utils/redis';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import {
  generateRefreshToken,
  hashRefreshToken,
  issueAccessToken,
  getAccessTokenExpiresIn,
} from './token.service';
import type { AuthTokens } from './auth.types';


// Types


interface CreateSessionParams {
  userId: string;
  deviceId: string;
  ipAddress: string;
  userAgent: string;
  fcmToken: string;
  kyc_tier: number;
}

interface RotateTokenParams {
  rawRefreshToken: string;
  deviceId: string;
  ipAddress: string;
  userAgent: string;
}


// Session creation


/**
 * Create a new device session and issue token pair.
 * Silently revokes the oldest session if the per-user limit is reached.
 */
export async function createSession(params: CreateSessionParams): Promise<AuthTokens> {
  const cfg = config();
  const { raw: rawRefresh, hash: refreshHash } = generateRefreshToken();

  const expiresAt = new Date(Date.now() + cfg.jwtRefreshTokenTtl * 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  // Enforce session limit — silently revoke oldest if at limit

  const activeSessions = await db.deviceSession.findMany({
    where: { user_id: params.userId, is_revoked: false },
    orderBy: { created_at: 'asc' },
    select: { id: true },
  });


  if (activeSessions.length >= cfg.maxSessionsPerUser) {
    // Revoke the oldest session to make room

    const oldest = activeSessions[0] as { id: string };

    await db.deviceSession.update({
      where: { id: oldest.id },
      data: { is_revoked: true },
    });
  }

  // Create new session

  const session = await db.deviceSession.create({
    data: {
      user_id: params.userId,
      device_id: params.deviceId,
      refresh_token: refreshHash,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
      fcm_token: params.fcmToken,
      expires_at: expiresAt,
    },
  });

  const accessToken = issueAccessToken({
    sub: params.userId,

    session_id: session.id as string,
    device_id: params.deviceId,
    tier: params.kyc_tier,
    iss: cfg.jwtIssuer,
    aud: cfg.jwtAudience,
  });

  return {
    access_token: accessToken,
    refresh_token: rawRefresh,
    expires_in: getAccessTokenExpiresIn(),
  };
}


// Token rotation


/**
 * Rotate a refresh token.
 *
 * Flow:
 *   1. Hash the incoming raw token
 *   2. Look up the session by hash
 *   3. If not found → token invalid/expired
 *   4. If found but already rotated (is_revoked) → REUSE DETECTED → revoke family
 *   5. Revoke old session, create new session with new token pair
 *
 * @returns New token pair
 * @throws AppError SESSION_REVOKED on reuse detection
 * @throws AppError SESSION_NOT_FOUND if token not found
 */
export async function rotateRefreshToken(params: RotateTokenParams): Promise<AuthTokens> {
  const cfg = config();
  const incomingHash = hashRefreshToken(params.rawRefreshToken);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;


  const session = await db.deviceSession.findUnique({
    where: { refresh_token: incomingHash },
    include: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      user: { select: { kyc_tier: true, account_status: true } },
    },
  });

  if (!session) {
    throw new AppError(ErrorCode.SESSION_NOT_FOUND, 'Session not found. Please log in again.');
  }

  // Reuse detection — if session is already revoked, someone is replaying an old token

  if (session.is_revoked) {
    // Revoke all sessions for this user on this device (family revocation)

    await db.deviceSession.updateMany({

      where: { user_id: session.user_id as string, device_id: session.device_id as string },
      data: { is_revoked: true },
    });

    throw new AppError(
      ErrorCode.SESSION_REVOKED,
      'This session has been revoked. Please log in again.',
    );
  }

  // Check session not expired

  if (new Date(session.expires_at as string) < new Date()) {
    throw new AppError(ErrorCode.TOKEN_EXPIRED, 'Your session has expired. Please log in again.');
  }

  // Revoke old session
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.deviceSession.update({

    where: { id: session.id as string },
    data: { is_revoked: true },
  });

  // Issue new token pair
  const { raw: newRaw, hash: newHash } = generateRefreshToken();
  const newExpiresAt = new Date(Date.now() + cfg.jwtRefreshTokenTtl * 1000);


  const newSession = await db.deviceSession.create({
    data: {

      user_id: session.user_id as string,
      device_id: params.deviceId,
      refresh_token: newHash,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,

      fcm_token: session.fcm_token as string | null,
      expires_at: newExpiresAt,
    },
  });


  const userTier = (session.user as { kyc_tier: number }).kyc_tier;

  const accessToken = issueAccessToken({

    sub: session.user_id as string,

    session_id: newSession.id as string,
    device_id: params.deviceId,
    tier: userTier,
    iss: cfg.jwtIssuer,
    aud: cfg.jwtAudience,
  });

  return {
    access_token: accessToken,
    refresh_token: newRaw,
    expires_in: getAccessTokenExpiresIn(),
  };
}


// Session revocation


/**
 * Revoke a single session by its refresh token hash.
 */
export async function revokeSession(rawRefreshToken: string): Promise<void> {
  const hash = hashRefreshToken(rawRefreshToken);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.deviceSession.updateMany({
    where: { refresh_token: hash },
    data: { is_revoked: true },
  });
}

/**
 * Revoke all sessions for a user.
 * @returns Number of sessions revoked.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const result = await db.deviceSession.updateMany({
    where: { user_id: userId, is_revoked: false },
    data: { is_revoked: true },
  });

  return (result as { count: number }).count;
}

/**
 * Revoke all sessions for a user EXCEPT the current session.
 * Used on passcode change — user stays logged in on current device.
 * @returns Number of other sessions revoked.
 */
export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const result = await db.deviceSession.updateMany({
    where: {
      user_id: userId,
      is_revoked: false,
      NOT: { id: currentSessionId },
    },
    data: { is_revoked: true },
  });

  return (result as { count: number }).count;
}

/**
 * Revoke a specific session by its ID (for the session management UI).
 * Validates that the session belongs to the requesting user.
 */
export async function revokeSessionById(
  sessionId: string,
  userId: string,
  currentSessionId: string,
): Promise<void> {
  if (sessionId === currentSessionId) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'Cannot revoke your current session. Use /auth/logout instead.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;


  const session = await db.deviceSession.findFirst({
    where: { id: sessionId, user_id: userId },
  });

  if (!session) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Session not found.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await db.deviceSession.update({
    where: { id: sessionId },
    data: { is_revoked: true },
  });
}


// Session blocklist (Redis) for immediate revocation within access token TTL


/**
 * Add a session to the Redis blocklist.
 * Used when we need immediate revocation within the 15-min access token window.
 */
export async function blocklistSession(sessionId: string): Promise<void> {
  const cfg = config();
  const key = `blocklist:session:${sessionId}`;
  await redis.set(key, '1', 'EX', cfg.jwtAccessTokenTtl);
}

/**
 * Check if a session is blocklisted.
 */
export async function isSessionBlocklisted(sessionId: string): Promise<boolean> {
  const key = `blocklist:session:${sessionId}`;
  const val = await redis.get(key);
  return val !== null;
}
