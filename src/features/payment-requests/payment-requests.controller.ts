import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import {
  CreatePaymentRequestSchema,
  PayPaymentRequestSchema,
  ListPaymentRequestsSchema,
} from './payment-requests.schema';
import {
  createPaymentRequest,
  listPaymentRequests,
  getPaymentRequest,
  payPaymentRequest,
  declinePaymentRequest,
  cancelPaymentRequest,
} from './payment-requests.service';

function userId(req: Request): string {
  return req.user!.sub as string;
}

// POST /payment-requests
export async function handleCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = CreatePaymentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }
    const result = await createPaymentRequest(userId(req), parsed.data);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /payment-requests
export async function handleList(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = ListPaymentRequestsSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }
    const { items, next_cursor } = await listPaymentRequests(userId(req), parsed.data);
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

// GET /payment-requests/:id
export async function handleGet(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const result = await getPaymentRequest(id, userId(req));
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /payment-requests/:id/pay
export async function handlePay(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const parsed = PayPaymentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '');
    const result = await payPaymentRequest(id, userId(req), parsed.data, idempotencyKey);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /payment-requests/:id/decline
export async function handleDecline(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    await declinePaymentRequest(id, userId(req));
    res.json({ success: true, data: { declined: true }, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /payment-requests/:id/cancel
export async function handleCancel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params['id'] as string;
    await cancelPaymentRequest(id, userId(req));
    res.json({ success: true, data: { cancelled: true }, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

