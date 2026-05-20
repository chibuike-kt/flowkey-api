import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { idempotencyCheck } from '../../common/middleware/idempotency';
import { requireFlag } from '../../common/middleware/featureFlag';
import {
  handleResolveRecipient,
  handleInternalTransfer,
  handleBankTransfer,
  handleListTransfers,
  handleGetTransaction,
  handleRetryTransfer,
  handleUidInternalTransfer,
  handleUidBankTransfer,
} from './transfers.controller';

const router = Router();
router.use(requireAuth);

router.post('/resolve-recipient', handleResolveRecipient);
router.post(
  '/internal',
  requireFlag('transfers.internal'),
  idempotencyCheck,
  handleInternalTransfer,
);
router.post('/bank', requireFlag('transfers.bank'), idempotencyCheck, handleBankTransfer);
router.get('/', handleListTransfers);
router.get('/:id', handleGetTransaction);
router.post('/:id/retry', handleRetryTransfer);

// UID transfers — requires an active FlowKey session on the device (friend's session)
// Sender is resolved from Universal ID + UPP, NOT from the session token
router.post('/uid/internal', requireAuth, idempotencyCheck, handleUidInternalTransfer);
router.post('/uid/bank', requireAuth, idempotencyCheck, handleUidBankTransfer);

export { router as transfersRouter };
