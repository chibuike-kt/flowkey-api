import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { handleGetBalance, handleListTransactions } from './wallet.controller';

const router = Router();

router.use(requireAuth);

// GET /wallet/balance
router.get('/balance', handleGetBalance);

// GET /wallet/transactions
router.get('/transactions', handleListTransactions);

export { router as walletRouter };
