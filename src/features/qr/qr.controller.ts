import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { GenerateQrSchema, DecodeQrSchema } from './qr.schema';
import {
  generateQrCode,
  decodeQrCode,
  getQrCode,
  deactivateQrCode,
  listQrCodes,
} from './qr.service';

function userId(req: Request): string {
  return req.user!.sub as string;
}

// POST /qr/generate
export async function handleGenerateQr(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = GenerateQrSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }
    const result = await generateQrCode(userId(req), parsed.data);
    res.status(201).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /qr/decode
export async function handleDecodeQr(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = DecodeQrSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }
    const result = await decodeQrCode(parsed.data.payload, userId(req));
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /qr
export async function handleListQr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await listQrCodes(userId(req));
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /qr/:id
export async function handleGetQr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'QR code ID is required.');
    const result = await getQrCode(id, userId(req));
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// DELETE /qr/:id
export async function handleDeactivateQr(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new AppError(ErrorCode.VALIDATION_ERROR, 'QR code ID is required.');
    await deactivateQrCode(id, userId(req));
    res.json({ success: true, data: { deactivated: true }, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}
