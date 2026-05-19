-- Phase 14 — Bills (VTPass)
-- Stores all bill payment transactions across all categories.
-- Money is debited from the FlowKey ledger before VTPass is called.
-- On failure the wallet is credited back (refund entry in ledger_entries).

CREATE TABLE "bill_transactions" (
  "id"                 UUID          NOT NULL DEFAULT gen_random_uuid(),
  "user_id"            UUID          NOT NULL,
  "wallet_id"          UUID          NOT NULL,
  "category"           VARCHAR(20)   NOT NULL, -- airtime | data | tv | electricity | education
  "service_id"         VARCHAR(50)   NOT NULL, -- vtpass serviceID
  "reference"          VARCHAR(50)   NOT NULL UNIQUE,
  "vtpass_request_id"  VARCHAR(100)  NOT NULL UNIQUE,
  "vtpass_order_id"    VARCHAR(100),
  "status"             VARCHAR(20)   NOT NULL DEFAULT 'pending',
  "amount"             BIGINT        NOT NULL,
  "fee"                BIGINT        NOT NULL DEFAULT 0,
  "narration"          VARCHAR(255)  NOT NULL,
  "recipient"          JSONB         NOT NULL DEFAULT '{}',
  "purchased_code"     TEXT,         -- electricity token
  "units"              VARCHAR(50),  -- electricity kWh
  "provider_response"  TEXT,
  "completed_at"       TIMESTAMPTZ,
  "created_at"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "bill_transactions_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "bill_transactions_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "bill_transactions_fee_non_negative" CHECK ("fee" >= 0),
  CONSTRAINT "bill_transactions_status_check"
    CHECK ("status" IN ('pending', 'processing', 'delivered', 'failed', 'refunded'))
);

-- Foreign keys
ALTER TABLE "bill_transactions"
  ADD CONSTRAINT "bill_transactions_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id");

ALTER TABLE "bill_transactions"
  ADD CONSTRAINT "bill_transactions_wallet_fk"
  FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id");

-- Indexes for common queries
CREATE INDEX "bill_transactions_user_id_idx"    ON "bill_transactions"("user_id");
CREATE INDEX "bill_transactions_wallet_id_idx"  ON "bill_transactions"("wallet_id");
CREATE INDEX "bill_transactions_status_idx"     ON "bill_transactions"("status");
CREATE INDEX "bill_transactions_category_idx"   ON "bill_transactions"("category");
CREATE INDEX "bill_transactions_created_at_idx" ON "bill_transactions"("created_at" DESC);

-- Allow ledger_entries to reference bill_transactions
-- bill_id is nullable — only set for bill debits/refunds
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "bill_id" UUID REFERENCES "bill_transactions"("id");
