import type { Request, Response, NextFunction } from 'express';
import { getKycStatus, upgradeKyc, listKycAttempts } from './kyc.service';
import { UpgradeKycSchema } from './kyc.schema';
import { AppError, ErrorCode } from '../../common/errors/AppError';

// GET /kyc/status
export async function handleGetKycStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const result = await getKycStatus(userId);
    res.json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /kyc/upgrade
export async function handleUpgradeKyc(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const parsed = UpgradeKycSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e) => e.message).join('; '),
      );
    }

    const result = await upgradeKyc(userId, parsed.data);
    res.status(200).json({ success: true, data: result, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /kyc/attempts
export async function handleListKycAttempts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
    const limit = Math.min(parseInt(String(req.query['limit'] ?? '20'), 10) || 20, 50);

    const result = await listKycAttempts(userId, cursor, limit);
    res.json({
      success: true,
      data: result.attempts,
      meta: { next_cursor: result.next_cursor, limit },
      error: null,
    });
  } catch (err) {
    next(err);
  }
}
