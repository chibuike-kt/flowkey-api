import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import {
  handleAddBeneficiary,
  handleListBeneficiaries,
  handleGetBeneficiary,
  handleUpdateBeneficiary,
  handleDeleteBeneficiary,
} from './beneficiaries.controller';

const router = Router();
router.use(requireAuth);

router.post('/', handleAddBeneficiary);
router.get('/', handleListBeneficiaries);
router.get('/:id', handleGetBeneficiary);
router.patch('/:id', handleUpdateBeneficiary);
router.delete('/:id', handleDeleteBeneficiary);

export { router as beneficiariesRouter };

