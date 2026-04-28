/**
 * FlowKey — Settings Router
 *
 * All settings endpoints. Passcode/PIN management lives here (not under /auth).
 * Forgot/reset passcode are public — no auth token required.
 */

import { Router } from 'express';
import * as AuthController from '../auth/auth.controller';
import { requireAuth } from '../../common/middleware/requireAuth';
import {
  forgotPasscodeRateLimit,
  userRateLimit,
  authRateLimit,
} from '../../common/middleware/rateLimiter';
import { idempotencyCheck } from '../../common/middleware/idempotency';

const router = Router();

// ===========================================================================
// PASSCODE MANAGEMENT
// ===========================================================================

// POST /settings/passcode/change  (protected)
router.post(
  '/passcode/change',
  requireAuth,
  authRateLimit,
  idempotencyCheck,
  AuthController.changePasscode,
);

// POST /settings/passcode/forgot  (public — no token required)
router.post(
  '/passcode/forgot',
  forgotPasscodeRateLimit,
  idempotencyCheck,
  AuthController.forgotPasscode,
);

// POST /settings/passcode/reset  (public — uses reset_token + OTPs)
router.post('/passcode/reset', authRateLimit, idempotencyCheck, AuthController.resetPasscode);

// ===========================================================================
// TRANSACTION PIN MANAGEMENT
// ===========================================================================

// POST /settings/pin/set  (protected)
router.post(
  '/pin/set',
  requireAuth,
  authRateLimit,
  idempotencyCheck,
  AuthController.setTransactionPin,
);

// POST /settings/pin/change  (protected)
router.post(
  '/pin/change',
  requireAuth,
  authRateLimit,
  idempotencyCheck,
  AuthController.changeTransactionPin,
);

// DELETE /settings/pin  (protected)
router.delete('/pin', requireAuth, idempotencyCheck, AuthController.deleteTransactionPin);

// ===========================================================================
// SESSION MANAGEMENT
// ===========================================================================

// GET /settings/sessions  (protected)
router.get('/sessions', requireAuth, userRateLimit, AuthController.listSessions);

// DELETE /settings/sessions/:id  (protected)
router.delete('/sessions/:id', requireAuth, idempotencyCheck, AuthController.revokeSession);

export { router as settingsRouter };
