import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { idempotencyCheck } from '../../common/middleware/idempotency';
import {
  handleBuyAirtime,
  handleGetDataPlans,
  handleBuyData,
  handleGetTvPlans,
  handleVerifySmartcard,
  handlePayTv,
  handleGetDiscos,
  handleVerifyMeter,
  handlePayElectricity,
  handlePayEducation,
  handleListBills,
  handleGetBill,
  handleRequeryBill,
} from './bills.controller';

const router = Router();
router.use(requireAuth);

// ── Airtime ──────────────────────────────────────────────────────────────────
router.post('/airtime', idempotencyCheck, handleBuyAirtime);

// ── Data ─────────────────────────────────────────────────────────────────────
router.get('/data/plans', handleGetDataPlans);
router.post('/data', idempotencyCheck, handleBuyData);

// ── TV ───────────────────────────────────────────────────────────────────────
router.get('/tv/plans', handleGetTvPlans);
router.post('/tv/verify', handleVerifySmartcard);
router.post('/tv', idempotencyCheck, handlePayTv);

// ── Electricity ───────────────────────────────────────────────────────────────
router.get('/electricity/discos', handleGetDiscos);
router.post('/electricity/verify', handleVerifyMeter);
router.post('/electricity', idempotencyCheck, handlePayElectricity);

// ── Education ─────────────────────────────────────────────────────────────────
router.post('/education', idempotencyCheck, handlePayEducation);

// ── History ───────────────────────────────────────────────────────────────────
router.get('/', handleListBills);
router.get('/:id', handleGetBill);
router.post('/:id/requery', handleRequeryBill);

export { router as billsRouter };
