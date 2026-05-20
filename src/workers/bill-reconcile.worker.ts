import { Worker } from 'bullmq';
import { createRedisConnection } from '../common/utils/redis';
import { logger } from '../common/utils/logger';
import { prisma } from '../common/utils/prisma';
import { requeryTransaction } from '../features/bills/vtpass.provider';
import {
  vtpassIsDelivered,
  vtpassIsPending,
  isMalformedProviderResponse,
  finalizeBillSuccess,
  finalizeBillRefunded,
  enqueueReconcile,
  serializeProviderResponse,
} from '../features/bills/bills.service';
import type { BillReconcileJobData } from '../queues/jobs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const MAX_ATTEMPTS = 6;

export function createBillReconcileWorker(): Worker {
  return new Worker<BillReconcileJobData>(
    'bill-reconcile',
    async (job) => {
      const { billId, walletId, amountKobo: amountKoboStr, reference, attemptNumber } = job.data;
      const amountKobo = BigInt(amountKoboStr);

      logger.info('bill_reconcile_attempt', { bill_id: billId, attempt: attemptNumber });

      // ── Fetch current bill state ──────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const row = (await db.billTransaction.findUnique({
        where: { id: billId },
        select: { id: true, status: true, vtpass_request_id: true },
      })) as { id: string; status: string; vtpass_request_id: string } | null;

      if (!row) {
        logger.warn('bill_reconcile_skipped_not_found', { bill_id: billId });
        return;
      }

      // Already resolved — skip
      if (
        row.status === 'delivered' ||
        row.status === 'refunded' ||
        row.status === 'reconciliation_required'
      ) {
        logger.info('bill_reconcile_skipped_already_resolved', {
          bill_id: billId,
          status: row.status,
        });
        return;
      }

      // ── Call VTPass requery ───────────────────────────────────────────────
      let result: unknown;
      try {
        result = await requeryTransaction(row.vtpass_request_id);
      } catch (err) {
        logger.warn('bill_reconcile_requery_failed', {
          bill_id: billId,
          attempt: attemptNumber,
          error: err instanceof Error ? err.message : String(err),
        });
        result = null;
      }

      // ── Process result ────────────────────────────────────────────────────

      if (vtpassIsDelivered(result)) {
        await finalizeBillSuccess(billId, result);
        logger.info('bill_reconcile_delivered', { bill_id: billId, attempt: attemptNumber });
        return;
      }

      if (!isMalformedProviderResponse(result) && !vtpassIsPending(result)) {
        // Provider confirmed failure
        await finalizeBillRefunded(billId, walletId, amountKobo, reference, result);
        logger.info('bill_reconcile_failed_refunded', { bill_id: billId, attempt: attemptNumber });
        return;
      }

      // Still pending or uncertain — schedule next attempt
      if (attemptNumber >= MAX_ATTEMPTS) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        await db.billTransaction.update({
          where: { id: billId },
          data: {
            status: 'reconciliation_required',
            provider_response: serializeProviderResponse(result),
          },
        });
        logger.error('bill_reconcile_exhausted', {
          bill_id: billId,
          attempts_made: attemptNumber,
          last_response: serializeProviderResponse(result).slice(0, 200),
        });
        return;
      }

      // Queue next attempt
      await enqueueReconcile(billId, walletId, amountKobo, reference, attemptNumber + 1);
      logger.info('bill_reconcile_rescheduled', {
        bill_id: billId,
        next_attempt: attemptNumber + 1,
      });
    },
    {
      connection: createRedisConnection(),
      prefix: process.env['REDIS_KEY_PREFIX'] ?? 'fk',
      concurrency: 5,
    },
  );
}
