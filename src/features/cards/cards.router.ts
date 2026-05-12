import { Router } from 'express';
import { requireAuth } from '../../common/middleware/requireAuth';
import { handleAddCard, handleListCards, handleRemoveCard } from '../deposits/deposits.controller';

const router = Router();
router.use(requireAuth);

router.post('/', handleAddCard);
router.get('/', handleListCards);
router.delete('/:id', handleRemoveCard);

export { router as cardsRouter };

