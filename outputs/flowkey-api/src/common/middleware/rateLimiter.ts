/**
 * FlowKey — Rate Limiter Middleware
 *
 * Redis-backed sliding window rate limiters.
 * Applied per-endpoint with endpoint-specific limits.
 *
 * All limits are per-IP AND per-user (where authenticated).
 * Auth endpoints get stricter limits.
 */

import { RateLimiterRedis } from 'rate-limiter-flexible';
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../utils/redis';
import { AppError, ErrorCode } from '../errors/AppError';

// ---------------------------------------------------------------------------
// Limiter factories
// ---------------------------------------------------------------------------

function makeIpLimiter(keyPrefix: string, points: number, durationSeconds: number) {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration: durationSeconds,
    blockDuration: 0, // do not block — just reject over-limit requests
  });
}

// ---------------------------------------------------------------------------
// Limiter instances
// ---------------------------------------------------------------------------

// Auth endpoints — per IP
const authIpLimiter = makeIpLimiter('rl:auth:ip', 20, 900); // 20 per 15 min per IP

// OTP submission — per IP
const otpIpLimiter = makeIpLimiter('rl:otp:ip', 10, 300); // 10 per 5 min per IP

// OTP resend — per IP
const otpResendIpLimiter = makeIpLimiter('rl:otp_resend:ip', 5, 1800); // 5 per 30 min per IP

// General API — per IP
const generalIpLimiter = makeIpLimiter('rl:general:ip', 100, 900); // 100 per 15 min per IP

// General API — per user (applied after auth)
const generalUserLimiter = makeIpLimiter('rl:general:user', 200, 900); // 200 per 15 min per user

// Financial endpoints — per user (stricter)
const financialUserLimiter = makeIpLimiter('rl:financial:user', 30, 900); // 30 per 15 min per user

// Forgot passcode — per IP (prevent enumeration)
const forgotPasscodeLimiter = makeIpLimiter('rl:forgot:ip', 5, 3600); // 5 per hr per IP

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

function ipKey(req: Request): string {
  return req.ip ?? 'unknown';
}

function userKey(req: Request): string {
  return req.user?.sub ?? ipKey(req);
}

async function consume(limiter: RateLimiterRedis, key: string, next: NextFunction): Promise<void> {
  try {
    await limiter.consume(key);
    next();
  } catch {
    next(
      new AppError(ErrorCode.RATE_LIMITED, 'Too many requests. Please wait before trying again.'),
    );
  }
}

// ---------------------------------------------------------------------------
// Exported middleware
// ---------------------------------------------------------------------------

export function authRateLimit(req: Request, _res: Response, next: NextFunction): void {
  void consume(authIpLimiter, ipKey(req), next);
}

export function otpRateLimit(req: Request, _res: Response, next: NextFunction): void {
  void consume(otpIpLimiter, ipKey(req), next);
}

export function otpResendRateLimit(req: Request, _res: Response, next: NextFunction): void {
  void consume(otpResendIpLimiter, ipKey(req), next);
}

export function generalRateLimit(req: Request, _res: Response, next: NextFunction): void {
  void consume(generalIpLimiter, ipKey(req), next);
}

export function userRateLimit(req: Request, _res: Response, next: NextFunction): void {
  void consume(generalUserLimiter, userKey(req), next);
}

export function financialRateLimit(req: Request, _res: Response, next: NextFunction): void {
  void consume(financialUserLimiter, userKey(req), next);
}

export function forgotPasscodeRateLimit(req: Request, _res: Response, next: NextFunction): void {
  void consume(forgotPasscodeLimiter, ipKey(req), next);
}
