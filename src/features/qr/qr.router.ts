import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import {
  handleGenerateQr,
  handleDecodeQr,
  handleListQr,
  handleGetQr,
  handleDeactivateQr,
} from './qr.controller';

const router = Router();
router.use(requireAuth);

router.post('/generate', handleGenerateQr);
router.post('/decode', handleDecodeQr);
router.get('/', handleListQr);
router.get('/:id', handleGetQr);
router.delete('/:id', handleDeactivateQr);

export { router as qrRouter };
