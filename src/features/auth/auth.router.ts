/**
 * FlowKey — Auth & Settings Router
 *
 * Mounts all auth and settings endpoints with appropriate middleware chains.
 *
 * Public routes (no auth required):
 *   POST /auth/register
 *   POST /auth/verify-phone
 *   POST /auth/resend-phone-otp
 *   POST /auth/verify-email
 *   POST /auth/resend-email-otp
 *   POST /auth/login
 *   POST /auth/refresh
 *   POST /settings/passcode/forgot
 *   POST /settings/passcode/reset
 *
 * Protected routes (requireAuth):
 *   POST /auth/logout
 *   POST /auth/logout-all
 *   GET  /auth/me
 *   POST /settings/passcode/change
 *   POST /settings/pin/set
 *   POST /settings/pin/change
 *   DELETE /settings/pin
 *   GET  /settings/sessions
 *   DELETE /settings/sessions/:id
 */

import { Router } from 'express';
import * as AuthController from './auth.controller';
import { requireAuth } from '../../common/middleware/requireAuth';
import {
  authRateLimit,
  otpRateLimit,
  otpResendRateLimit,

  userRateLimit,
} from '../../common/middleware/rateLimiter';
import { idempotencyCheck } from '../../common/middleware/idempotency';

const router = Router();

// ===========================================================================
// AUTH — Public
// ===========================================================================

// POST /auth/register
router.post('/register', authRateLimit, idempotencyCheck, AuthController.register);

// POST /auth/verify-phone
router.post('/verify-phone', otpRateLimit, idempotencyCheck, AuthController.verifyPhone);

// POST /auth/resend-phone-otp
router.post(
  '/resend-phone-otp',
  otpResendRateLimit,
  idempotencyCheck,
  AuthController.resendPhoneOtp,
);

// POST /auth/verify-email
router.post('/verify-email', otpRateLimit, idempotencyCheck, AuthController.verifyEmail);

// POST /auth/resend-email-otp
router.post(
  '/resend-email-otp',
  otpResendRateLimit,
  idempotencyCheck,
  AuthController.resendEmailOtp,
);

// POST /auth/login
router.post('/login', authRateLimit, idempotencyCheck, AuthController.login);

// POST /auth/refresh
router.post('/refresh', authRateLimit, AuthController.refreshToken);

// ===========================================================================
// AUTH — Protected
// ===========================================================================

// POST /auth/logout
router.post('/logout', requireAuth, idempotencyCheck, AuthController.logout);

// POST /auth/logout-all
router.post('/logout-all', requireAuth, AuthController.logoutAll);

// GET /auth/me
router.get('/me', requireAuth, userRateLimit, AuthController.getMe);

export { router as authRouter };
