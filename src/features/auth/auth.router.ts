import { Router } from 'express';
import * as C from './auth.controller';
import { requireAuth } from '../../common/middleware/requireAuth';
import {
  authRateLimit,
  otpRateLimit,
  otpResendRateLimit,
  loginRateLimit,
  userRateLimit,
} from '../../common/middleware/rateLimiter';
import { idempotencyCheck } from '../../common/middleware/idempotency';

const router = Router();

// Registration flow
router.post('/initiate', authRateLimit, idempotencyCheck, C.initiateRegistration);
router.post('/verify-otp', otpRateLimit, idempotencyCheck, C.verifyRegistrationOtp);
router.post('/resend-otp', otpResendRateLimit, idempotencyCheck, C.resendRegistrationOtp);
router.get('/check-username', userRateLimit, C.checkUsername);
router.post('/complete', authRateLimit, idempotencyCheck, C.completeRegistration);

// Session
router.post('/login', loginRateLimit, idempotencyCheck, C.login);
router.post('/refresh', authRateLimit, C.refreshToken);
router.post('/unlock', authRateLimit, idempotencyCheck, C.unlockWithPasscode);
router.post('/logout', requireAuth, idempotencyCheck, C.logout);
router.post('/logout-all', requireAuth, C.logoutAll);
router.get('/me', requireAuth, userRateLimit, C.getMe);

export { router as authRouter };
