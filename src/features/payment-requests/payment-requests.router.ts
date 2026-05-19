import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { idempotencyCheck } from '../../common/middleware/idempotency';
import {
  handleCreate,
  handleList,
  handleGet,
  handlePay,
  handleDecline,
  handleCancel,
} from './payment-requests.controller';

const router = Router();
router.use(requireAuth);

router.post('/', idempotencyCheck, handleCreate);
router.get('/', handleList);
router.get('/:id', handleGet);
router.post('/:id/pay', idempotencyCheck, handlePay);
router.post('/:id/decline', idempotencyCheck, handleDecline);
router.post('/:id/cancel', idempotencyCheck, handleCancel);

export { router as paymentRequestsRouter };
