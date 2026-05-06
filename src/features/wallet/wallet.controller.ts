import type { Request, Response, NextFunction } from 'express';
import { getWalletBalance, listWalletTransactions } from './wallet.service';

export async function handleGetBalance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const balance = await getWalletBalance(userId);
    res.json({ success: true, data: balance, meta: null, error: null });
  } catch (err) {
    next(err);
  }
}

export async function handleListTransactions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
    const limit = Math.min(parseInt(String(req.query['limit'] ?? '20'), 10) || 20, 50);

    const result = await listWalletTransactions(userId, cursor, limit);
    res.json({
      success: true,
      data: result.transactions,
      meta: { next_cursor: result.next_cursor, limit },
      error: null,
    });
  } catch (err) {
    next(err);
  }
}
