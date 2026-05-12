import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { AddCardSchema, CardDepositSchema, ListDepositsSchema } from './deposits.schema';
import {
  provisionUserVirtualAccount,
  getUserVirtualAccount,
  addCard,
  listCards,
  removeCard,
  initiateCardDeposit,
  listDeposits,
} from './deposits.service';

function userId(req: Request): string {
  return req.user!.sub as string;
}

// POST /deposits/virtual-account
export async function handleProvisionVirtualAccount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await provisionUserVirtualAccount(userId(req));
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /deposits/virtual-account
export async function handleGetVirtualAccount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await getUserVirtualAccount(userId(req));
    if (!result) {
      res.json({ success: true, data: null, meta: null, error: null });
      return;
    }
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /deposits
export async function handleListDeposits(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ListDepositsSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }
    const { items, next_cursor } = await listDeposits(userId(req), parsed.data);
    res.json({
      success: true,
      data: items,
      meta: { next_cursor, limit: parsed.data.limit },
      error: null,
    });
  } catch (err) {
    next(err);
  }
}

// POST /cards/add
export async function handleAddCard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = AddCardSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }
    const result = await addCard(userId(req), parsed.data);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /cards
export async function handleListCards(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await listCards(userId(req));
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// DELETE /cards/:id
export async function handleRemoveCard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Card ID is required.');
    await removeCard(id, userId(req));
    res.json({ success: true, data: { removed: true }, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /deposits/card
export async function handleCardDeposit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = CardDepositSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '');
    const result = await initiateCardDeposit(userId(req), parsed.data, idempotencyKey);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}
