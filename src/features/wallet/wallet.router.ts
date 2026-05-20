import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import {
  handleGetBalance,
  handleListTransactions,
  handleGetTransactionDetail,
} from './wallet.controller';

const router = Router();

router.use(requireAuth);

// GET /wallet/balance
router.get('/balance', handleGetBalance);

// GET /wallet/transactions
router.get('/transactions', handleListTransactions);

// GET /wallet/transactions/:id
router.get('/transactions/:id', handleGetTransactionDetail);

export { router as walletRouter };
