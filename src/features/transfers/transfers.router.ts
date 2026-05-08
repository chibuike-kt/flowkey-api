import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { idempotencyCheck } from '../../common/middleware/idempotency';
import {
  handleResolveRecipient,
  handleInternalTransfer,
  handleBankTransfer,
  handleListTransfers,
  handleGetTransaction,
  handleRetryTransfer,
} from './transfers.controller';

const router = Router();
router.use(requireAuth);

router.post('/resolve-recipient', handleResolveRecipient);
router.post('/internal', idempotencyCheck, handleInternalTransfer);
router.post('/bank', idempotencyCheck, handleBankTransfer);
router.get('/', handleListTransfers);
router.get('/:id', handleGetTransaction);
router.post('/:id/retry', handleRetryTransfer);

export { router as transfersRouter };
