import { Router } from 'express';
import * as C from '../auth/auth.controller';
import { requireAuth } from '../../common/middleware/requireAuth';
import {
  authRateLimit,
  forgotPasscodeRateLimit,
  userRateLimit,
} from '../../common/middleware/rateLimiter';
import { idempotencyCheck } from '../../common/middleware/idempotency';

const router = Router();

// Passcode
router.post('/passcode/change', requireAuth, authRateLimit, idempotencyCheck, C.changePasscode);
router.post('/passcode/forgot', forgotPasscodeRateLimit, idempotencyCheck, C.forgotPasscode);
router.post('/passcode/reset', authRateLimit, idempotencyCheck, C.resetPasscode);

// Transaction PIN
router.post('/pin/set', requireAuth, authRateLimit, idempotencyCheck, C.setTransactionPin);
router.post('/pin/change', requireAuth, authRateLimit, idempotencyCheck, C.changeTransactionPin);
router.delete('/pin', requireAuth, idempotencyCheck, C.deleteTransactionPin);

// Universal Payment PIN
router.post('/upp/set', requireAuth, authRateLimit, idempotencyCheck, C.setUpp);
router.post('/upp/change', requireAuth, authRateLimit, idempotencyCheck, C.changeUpp);

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
