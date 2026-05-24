import { RateLimiterRedis } from 'rate-limiter-flexible';
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../utils/redis';
import { AppError, ErrorCode } from '../errors/AppError';

// ---------------------------------------------------------------------------
// Limiter factory
// ---------------------------------------------------------------------------

function makeLimiter(keyPrefix: string, points: number, durationSeconds: number) {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration: durationSeconds,
    blockDuration: 0, // reject, never block — blocking causes thundering-herd on retry
  });
}

// ---------------------------------------------------------------------------
// Layer 1 — per-IP (infrastructure protection)
// ---------------------------------------------------------------------------

// Auth endpoints: 200 requests per 15 min per IP
// Handles payday surges where many users share a carrier NAT IP
const authIpLimiter = makeLimiter('rl:auth:ip', 200, 900);

// General API: 500 per 15 min per IP
const generalIpLimiter = makeLimiter('rl:general:ip', 500, 900);

// ---------------------------------------------------------------------------
// Layer 2 — per-identifier (account protection)
// ---------------------------------------------------------------------------

// OTP submission: 10 attempts per 5 min per contact (phone/email)
// Still allows the OTP service's own 3-attempt limit to trigger first
const otpIdentifierLimiter = makeLimiter('rl:otp:id', 10, 300);

// OTP resend: 5 per 30 min per contact
const otpResendIdentifierLimiter = makeLimiter('rl:otp_resend:id', 5, 1800);

// Login: 10 per 15 min per contact — brute force protection
const loginIdentifierLimiter = makeLimiter('rl:login:id', 10, 900);

// General authenticated: 300 per 15 min per userId
const generalUserLimiter = makeLimiter('rl:general:user', 300, 900);

// Financial ops: 50 per 15 min per userId
// Raised from 30 — a user buying airtime + data + electricity on payday = 3 ops
const financialUserLimiter = makeLimiter('rl:financial:user', 50, 900);

// Forgot passcode: 5 per hr per IP (prevent enumeration)
const forgotPasscodeLimiter = makeLimiter('rl:forgot:ip', 5, 3600);

// ---------------------------------------------------------------------------
// Key extractors
// ---------------------------------------------------------------------------

function ipKey(req: Request): string {
  return req.ip ?? 'unknown';
}

function userKey(req: Request): string {
  return req.user?.sub ?? ipKey(req);
}

/**
 * Extract the contact identifier from the request body.
 * Used for per-identifier (not per-IP) rate limiting on auth flows.
 * Falls back to IP if no contact is present.
 */
function contactKey(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const contact = body?.['contact'] as string | undefined;
  return contact ? `contact:${contact}` : ipKey(req);
}

// ---------------------------------------------------------------------------
// Core consume helper — attaches Retry-After header on rejection
// ---------------------------------------------------------------------------

async function consume(
  limiter: RateLimiterRedis,
  key: string,
  next: NextFunction,
  res: Response,
): Promise<void> {
  try {
    await limiter.consume(key);
    next();
  } catch (rlError) {
    // rlError from rate-limiter-flexible contains msBeforeNext
    const msBeforeNext = (rlError as { msBeforeNext?: number }).msBeforeNext ?? 60_000;
    const retryAfterSecs = Math.ceil(msBeforeNext / 1000);
    res.set('Retry-After', String(retryAfterSecs));
    next(
      new AppError(
        ErrorCode.RATE_LIMITED,
        `Too many requests. Please try again in ${retryAfterSecs} seconds.`,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Exported middleware
// ---------------------------------------------------------------------------

/** Auth endpoints — per IP (Layer 1 only, loose) */
export function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  void consume(authIpLimiter, ipKey(req), next, res);
}

/** OTP submission — per contact identifier (Layer 2, tight) */
export function otpRateLimit(req: Request, res: Response, next: NextFunction): void {
  void consume(otpIdentifierLimiter, contactKey(req), next, res);
}

/** OTP resend — per contact identifier */
export function otpResendRateLimit(req: Request, res: Response, next: NextFunction): void {
  void consume(otpResendIdentifierLimiter, contactKey(req), next, res);
}

/** Login — per contact identifier (brute force protection) */
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  void consume(loginIdentifierLimiter, contactKey(req), next, res);
}

/** General unauthenticated — per IP */
export function generalRateLimit(req: Request, res: Response, next: NextFunction): void {
  void consume(generalIpLimiter, ipKey(req), next, res);
}

/** General authenticated — per userId */
export function userRateLimit(req: Request, res: Response, next: NextFunction): void {
  void consume(generalUserLimiter, userKey(req), next, res);
}

/** Financial operations — per userId */
export function financialRateLimit(req: Request, res: Response, next: NextFunction): void {
  void consume(financialUserLimiter, userKey(req), next, res);
}

/** Forgot passcode — per IP (enumeration protection) */
export function forgotPasscodeRateLimit(req: Request, res: Response, next: NextFunction): void {
  void consume(forgotPasscodeLimiter, ipKey(req), next, res);
}
