-- Create bills table
CREATE TABLE "bill_transactions" (
  "id"                 UUID          NOT NULL DEFAULT gen_random_uuid(),
  "user_id"            UUID          NOT NULL,
  "wallet_id"          UUID          NOT NULL,
  "category"           VARCHAR(20)   NOT NULL,
  "service_id"         VARCHAR(50)   NOT NULL,
  "reference"          VARCHAR(50)   NOT NULL UNIQUE,
  "vtpass_request_id"  VARCHAR(100)  NOT NULL UNIQUE,
  "vtpass_order_id"    VARCHAR(100),
  "status"             VARCHAR(20)   NOT NULL DEFAULT 'pending',
  "amount"             BIGINT        NOT NULL,
  "fee"                BIGINT        NOT NULL DEFAULT 0,
  "narration"          VARCHAR(255)  NOT NULL,
  "recipient"          JSONB         NOT NULL DEFAULT '{}',
  "purchased_code"     TEXT,
  "units"              VARCHAR(50),
  "provider_response"  TEXT,
  "completed_at"       TIMESTAMPTZ,
  "created_at"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT "bill_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bill_transactions_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "bill_transactions_fee_non_negative" CHECK ("fee" >= 0),
  CONSTRAINT "bill_transactions_status_check"
    CHECK ("status" IN ('pending', 'processing', 'delivered', 'failed', 'refunded'))
);

ALTER TABLE "bill_transactions"
  ADD CONSTRAINT "bill_transactions_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id");

ALTER TABLE "bill_transactions"
  ADD CONSTRAINT "bill_transactions_wallet_fk"
  FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id");

-- Ledger entries updates
ALTER TABLE "ledger_entries" ALTER COLUMN "transaction_id" DROP NOT NULL;
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "bill_id" UUID REFERENCES "bill_transactions"("id");
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "reference" VARCHAR(100);
