import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { ResolveRecipientSchema, InternalTransferSchema } from './transfers.schema';
import { resolveRecipient, executeInternalTransfer, getTransactionById } from './transfers.service';

// POST /transfers/resolve-recipient
export async function handleResolveRecipient(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ResolveRecipientSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }
    const result = await resolveRecipient(parsed.data.identifier, req.user!.sub);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /transfers/internal
export async function handleInternalTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = InternalTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }

    const idempotencyKey = String(req.headers['idempotency-key'] ?? '');

    const result = await executeInternalTransfer(
      req.user!.sub,
      parsed.data.recipient_wallet_id,
      parsed.data.amount_kobo,
      parsed.data.pin,
      parsed.data.narration,
      idempotencyKey,
    );

    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /transfers/:id
export async function handleGetTransaction(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Transaction ID is required.');
    const result = await getTransactionById(id, req.user!.sub as string);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}
