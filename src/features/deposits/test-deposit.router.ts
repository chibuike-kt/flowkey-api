import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../common/middleware/requireAuth';
import { AppError, ErrorCode } from '../../common/errors/AppError';
import { creditWallet } from './deposits.service';
import { prisma } from '../../common/utils/prisma';
import { logger } from '../../common/utils/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const router = Router();

const TestDepositSchema = z.object({
  amount_kobo: z
    .number()
    .int('Amount must be an integer')
    .positive('Amount must be positive')
    .min(100, 'Minimum test deposit is ₦1 (100 kobo)')
    .max(100_000_000_00, 'Maximum test deposit is ₦1,000,000,000'),
  narration: z.string().max(255).optional(),
});

router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  // Hard block in production — this guard is the safety net
  if (process.env['NODE_ENV'] === 'production') {
    return next(
      new AppError(ErrorCode.FORBIDDEN, 'Test deposits are not available in production.'),
    );
  }

  try {
    const parsed = TestDepositSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((e: { message: string }) => e.message).join('; '),
      );
    }

    const userId = req.user!.sub as string;
    const amountKobo = BigInt(parsed.data.amount_kobo);
    const narration =
      parsed.data.narration ??
      `Test deposit — ₦${(parsed.data.amount_kobo / 100).toLocaleString()}`;

    // Load wallet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const wallet = (await db.wallet.findUnique({
      where: { user_id: userId },
      select: { id: true },
    })) as { id: string } | null;

    if (!wallet) throw new AppError(ErrorCode.NOT_FOUND, 'Wallet not found.');

    const reference = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const providerRef = `TEST-STUB-${Date.now()}`;

    await creditWallet({
      walletId: wallet.id,
      amountKobo,
      channel: 'virtual_account',
      reference,
      providerRef,
      narration,
    });

    logger.warn('[TEST DEPOSIT] Wallet funded directly — not a real transaction', {
      user_id: userId,
      wallet_id: wallet.id,
      amount_kobo: amountKobo.toString(),
      reference,
    });

    res.status(201).json({
      success: true,
      data: {
        reference,
        amount_kobo: amountKobo.toString(),
        narration,
        status: 'completed',
        note: 'This is a test deposit. Not available in production.',
      },
      meta: null,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

export { router as testDepositRouter };
