-- Materialized wallet balances
ALTER TABLE "wallets"
  ADD COLUMN IF NOT EXISTS "available_balance" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pending_balance"   BIGINT NOT NULL DEFAULT 0;

-- Backfill from existing ledger entries
UPDATE "wallets" w
SET "available_balance" = COALESCE((
  SELECT SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END)
  FROM "ledger_entries"
  WHERE wallet_id = w.id
), 0);

ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_available_balance_non_negative"
  CHECK ("available_balance" >= 0);

-- Bills idempotency
ALTER TABLE "bill_transactions"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS "bill_transactions_idempotency_key_user_idx"
  ON "bill_transactions"("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- Extended status values
ALTER TABLE "bill_transactions"
  DROP CONSTRAINT IF EXISTS "bill_transactions_status_check";

ALTER TABLE "bill_transactions"
  ADD CONSTRAINT "bill_transactions_status_check"
  CHECK ("status" IN (
    'pending', 'processing', 'delivered', 'failed',
    'refunded', 'provider_uncertain', 'reconciliation_required'
  ));
