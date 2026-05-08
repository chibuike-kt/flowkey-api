import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { idempotencyCheck } from '../../common/middleware/idempotency';
import {
  handleResolveRecipient,
  handleInternalTransfer,
  handleGetTransaction,
} from './transfers.controller';

const router = Router();

router.use(requireAuth);

// POST /transfers/resolve-recipient
router.post('/resolve-recipient', handleResolveRecipient);

// POST /transfers/internal
router.post('/internal', idempotencyCheck, handleInternalTransfer);

// GET /transfers/:id
router.get('/:id', handleGetTransaction);

export { router as transfersRouter };
