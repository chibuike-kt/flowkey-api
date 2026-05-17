import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { handleGetMyQr, handleRegenerateQr, handleDecodeQr } from './qr.controller';

const router = Router();
router.use(requireAuth);

router.get('/me', handleGetMyQr);
router.post('/decode', handleDecodeQr);
router.post('/regenerate', handleRegenerateQr);

export { router as qrRouter };
