import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { requireFlag } from '../../common/middleware/featureFlag';
import { idempotencyCheck } from '../../common/middleware/idempotency';
import { handleGetKycStatus, handleUpgradeKyc, handleListKycAttempts } from './kyc.controller';

const router = Router();

// All KYC routes require authentication
router.use(requireAuth);

// GET  /kyc/status
router.get('/status', handleGetKycStatus);

// GET  /kyc/attempts
router.get('/attempts', handleListKycAttempts);

// POST /kyc/upgrade
router.post('/upgrade', requireFlag('kyc.tier2'), idempotencyCheck, handleUpgradeKyc);

export { router as kycRouter };
