import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { DecodeQrSchema } from './qr.schema';
import { getMyQrCode, regenerateQrCode, decodeQrCode } from './qr.service';

// GET /qr/me
export async function handleGetMyQr(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await getMyQrCode(req.user!.sub as string);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /qr/regenerate
export async function handleRegenerateQr(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await regenerateQrCode(req.user!.sub as string);
    res.json({ success: true, data: result, meta: null, error: null });
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
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }
    const result = await decodeQrCode(parsed.data.payload, req.user!.sub as string);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}
