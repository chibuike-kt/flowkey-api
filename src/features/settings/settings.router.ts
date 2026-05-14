import { Router } from 'express';
import * as C from '../auth/auth.controller';
import { requireAuth } from '../../common/middleware/requireAuth';
import {
  authRateLimit,
  forgotPasscodeRateLimit,
  otpRateLimit,
  userRateLimit,
} from '../../common/middleware/rateLimiter';
import { idempotencyCheck } from '../../common/middleware/idempotency';

const router = Router();

// Passcode
router.post('/passcode/change', requireAuth, authRateLimit, idempotencyCheck, C.changePasscode);
router.post('/passcode/forgot', forgotPasscodeRateLimit, idempotencyCheck, C.forgotPasscode);
router.post('/passcode/reset', authRateLimit, idempotencyCheck, C.resetPasscode);

// Transaction PIN
router.get('/pin/status', requireAuth, C.getTransactionPinStatus);
router.post('/pin/set', requireAuth, authRateLimit, idempotencyCheck, C.setTransactionPin);
router.post('/pin/reset/initiate', requireAuth, otpRateLimit, C.initiatePinReset);
router.post('/pin/reset/confirm', requireAuth, otpRateLimit, C.confirmPinResetOtp);
router.post('/pin/reset/complete', authRateLimit, idempotencyCheck, C.completePinReset);

// Universal Payment PIN
router.get('/upp/status', requireAuth, C.getUppStatus);
router.post('/upp/set', requireAuth, authRateLimit, idempotencyCheck, C.setUpp);
router.post('/upp/reset/initiate', requireAuth, otpRateLimit, C.initiateUppReset);
router.post('/upp/reset/confirm', requireAuth, otpRateLimit, C.confirmUppResetOtp);
router.post('/upp/reset/complete', authRateLimit, idempotencyCheck, C.completeUppReset);

// Universal ID
router.post(
  '/universal-id/revoke',
  requireAuth,
  authRateLimit,
  idempotencyCheck,
  C.revokeUniversalId,
);

// Sessions
router.get('/sessions', requireAuth, userRateLimit, C.listSessions);
router.delete('/sessions/:id', requireAuth, idempotencyCheck, C.revokeSession);

export { router as settingsRouter };
