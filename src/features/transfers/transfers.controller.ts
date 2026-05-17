/**
 * FlowKey — Transfers Controller
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import {
  ResolveRecipientSchema,
  InternalTransferSchema,
  BankTransferSchema,
  ListTransfersSchema,
  RetryTransferSchema,
  UidInternalTransferSchema,
  UidBankTransferSchema,
} from './transfers.schema';
import {
  resolveRecipient,
  executeUidInternalTransfer,
  executeUidBankTransfer,
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

// POST /transfers/uid/internal
// The friend's FlowKey session is active (requireAuth). The guest types
// their Universal ID + UPP. Transfer debits the guest's wallet, not the friend's.
export async function handleUidInternalTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = UidInternalTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '');
    // Pass device_user_id (friend's user) for audit trail — sender is resolved from UID
    const deviceUserId = req.user!.sub as string;
    const result = await executeUidInternalTransfer(parsed.data, idempotencyKey, deviceUserId);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /transfers/uid/bank
export async function handleUidBankTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = UidBankTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '');
    const deviceUserId = req.user!.sub as string;
    const result = await executeUidBankTransfer(parsed.data, idempotencyKey, deviceUserId);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}
