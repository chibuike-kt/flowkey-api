import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { AppError, ErrorCode } from '../errors/AppError';
import { logger } from '../utils/logger';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Attach idempotency context to req for downstream use
declare global {
  namespace Express {
    interface Request {
      idempotencyKey?: string;
      idempotencyHash?: string;
    }
  }
}

export async function idempotencyCheck(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = req.headers['idempotency-key'] as string | undefined;

    if (!key) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Idempotency-Key header is required for this endpoint. Generate a UUID v4.',
      );
    }

    if (!uuidV4Regex.test(key)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Idempotency-Key must be a valid UUID v4.');
    }

    // Hash the normalized request body for payload comparison
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');

    // Attach to req for service layer use
    req.idempotencyKey = key;
    req.idempotencyHash = bodyHash;

    // Look up existing record if user is authenticated
    if (req.user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = (await import('../utils/prisma.js')).prisma as any;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const existing = await db.idempotencyKey.findFirst({
        where: {
          key,
          user_id: req.user.sub,
          expires_at: { gt: new Date() },
        },
        select: {
          request_hash: true,
          response_snapshot: true,
          status: true,
        },
      });

      if (existing) {
        const record = existing as {
          request_hash: string;
          response_snapshot: unknown;
          status: string;
        };

        if (record.request_hash !== bodyHash) {
          // Key reuse with different payload — always an error, never a retry
          logger.warn('Idempotency key reuse with different payload', {
            key,
            userId: req.user.sub,
            existingHash: record.request_hash,
            incomingHash: bodyHash,
          });

          throw new AppError(
            ErrorCode.IDEMPOTENCY_KEY_MISMATCH,
            'This Idempotency-Key was already used with a different request payload. ' +
              'Generate a new UUID v4 for each unique request.',
          );
        }

        // Same key + same hash → return original response immediately
        if (record.status === 'completed') {
          res.status(200).json(record.response_snapshot);
          return;
        }

        // status = pending → request is still processing → let it through
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}
