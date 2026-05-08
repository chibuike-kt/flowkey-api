import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import {
  ResolveRecipientSchema,
  InternalTransferSchema,
  BankTransferSchema,
  ListTransfersSchema,
  RetryTransferSchema,
} from './transfers.schema';
import {
  resolveRecipient,
  executeInternalTransfer,
  initiateBankTransfer,
  getTransactionById,
  listTransactions,
  retryBankTransfer,
} from './transfers.service';

function parseUserId(req: Request): string {
  return req.user!.sub as string;
}

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
    const result = await resolveRecipient(parsed.data.identifier, parseUserId(req));
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
    const result = await executeInternalTransfer(parseUserId(req), parsed.data, idempotencyKey);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /transfers/bank
export async function handleBankTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = BankTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '');
    const result = await initiateBankTransfer(parseUserId(req), parsed.data, idempotencyKey);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /transfers
export async function handleListTransfers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ListTransfersSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }
    const { items, next_cursor } = await listTransactions(parseUserId(req), parsed.data);
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

// GET /transfers/:id
export async function handleGetTransaction(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Transaction ID is required.');
    const result = await getTransactionById(id, parseUserId(req));
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /transfers/:id/retry
export async function handleRetryTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Transaction ID is required.');
    const parsed = RetryTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }
    const result = await retryBankTransfer(id, parseUserId(req), parsed.data.pin);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}
