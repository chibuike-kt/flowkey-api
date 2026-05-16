import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { idempotencyCheck } from '../../common/middleware/idempotency';
import { requireFlag } from '../../common/middleware/featureFlag';
import {
  handleProvisionVirtualAccount,
  handleGetVirtualAccount,
  handleListDeposits,
  handleCardDeposit,
} from './deposits.controller';

const router = Router();
router.use(requireAuth);

router.post('/virtual-account', handleProvisionVirtualAccount);
router.get('/virtual-account', handleGetVirtualAccount);
router.get('/', handleListDeposits);
router.post('/card', requireFlag('deposits.card'), idempotencyCheck, handleCardDeposit);

export { router as depositsRouter };
