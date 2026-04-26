-- =============================================================================
-- FLOWKEY — MIGRATION: 20260425000000_phase3_initial_schema
-- Phase 3: Full database schema
-- =============================================================================
--
-- ROLLBACK STRATEGY:
--   Run the following to roll back this migration entirely:
--     DROP SCHEMA public CASCADE;
--     CREATE SCHEMA public;
--   This is destructive. Only run on a fresh database.
--   In production, a rollback of the initial schema migration is not possible
--   without data loss — treat this migration as irreversible once data exists.
--
-- WHAT THIS MIGRATION DOES:
--   1. Creates all enums
--   2. Creates all tables with constraints
--   3. Creates all indexes (beyond those from unique/pk constraints)
--   4. Creates append-only triggers for ledger_entries and audit_logs
--   5. Creates a function for audit log hash-chain verification
-- =============================================================================

-- Enable pgcrypto for gen_random_uuid() — required for UUID primary keys
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE "KycStatus" AS ENUM ('pending', 'passed', 'failed', 'error');

CREATE TYPE "TransactionType" AS ENUM (
  'transfer_internal',
  'transfer_bank',
  'bill_payment',
  'qr_payment',
  'terminal_payment',
  'reversal',
  'fee',
  'funding',
  'refund'
);

CREATE TYPE "TransactionStatus" AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed',
  'reversed',
  'disputed'
);

CREATE TYPE "LedgerEntryType" AS ENUM ('credit', 'debit');

CREATE TYPE "InitiatorType" AS ENUM ('user', 'system', 'admin', 'terminal', 'bot');

CREATE TYPE "DisputeStatus" AS ENUM (
  'open',
  'closed_no_action',
  'reversed',
  'escalated'
);

CREATE TYPE "NotificationChannel" AS ENUM ('push', 'email', 'sms');

CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'delivered', 'failed');

CREATE TYPE "BeneficiaryType" AS ENUM ('internal', 'bank');

CREATE TYPE "AdminRole" AS ENUM ('admin', 'super_admin');

CREATE TYPE "AccountStatus" AS ENUM (
  'pending_verification',
  'active',
  'frozen',
  'closed'
);

CREATE TYPE "BotSessionStatus" AS ENUM (
  'active',
  'completed',
  'expired',
  'terminated'
);

CREATE TYPE "BotState" AS ENUM (
  'idle',
  'intent_captured',
  'structured_command',
  'awaiting_confirmation',
  'pin_entry',
  'executing',
  'completed',
  'failed'
);

CREATE TYPE "WebhookProcessingStatus" AS ENUM (
  'queued',
  'processing',
  'completed',
  'failed'
);

CREATE TYPE "QrCodeType" AS ENUM ('static', 'dynamic');

-- =============================================================================
-- TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE "users" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "phone"          VARCHAR(20) NOT NULL,
  "email"          VARCHAR(255) NOT NULL,
  "display_name"   VARCHAR(100) NOT NULL,
  "universal_id"   VARCHAR(20) NOT NULL,
  "kyc_tier"       SMALLINT    NOT NULL DEFAULT 0,
  "account_status" "AccountStatus" NOT NULL DEFAULT 'pending_verification',
  "deleted_at"     TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_phone_key" UNIQUE ("phone"),
  CONSTRAINT "users_email_key" UNIQUE ("email"),
  CONSTRAINT "users_universal_id_key" UNIQUE ("universal_id"),
  CONSTRAINT "users_kyc_tier_check" CHECK ("kyc_tier" >= 0 AND "kyc_tier" <= 3)
);

CREATE INDEX "users_phone_idx"          ON "users"("phone");
CREATE INDEX "users_email_idx"          ON "users"("email");
CREATE INDEX "users_universal_id_idx"   ON "users"("universal_id");
CREATE INDEX "users_account_status_idx" ON "users"("account_status");
CREATE INDEX "users_kyc_tier_idx"       ON "users"("kyc_tier");
CREATE INDEX "users_deleted_at_idx"     ON "users"("deleted_at");

-- -----------------------------------------------------------------------------
-- user_auth
-- -----------------------------------------------------------------------------
CREATE TABLE "user_auth" (
  "id"                              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"                         UUID         NOT NULL,
  "login_passcode_hash"             VARCHAR(255) NOT NULL,
  "login_passcode_failed_attempts"  SMALLINT     NOT NULL DEFAULT 0,
  "login_passcode_locked_until"     TIMESTAMPTZ,
  "login_passcode_hard_locked"      BOOLEAN      NOT NULL DEFAULT FALSE,
  "login_passcode_lockout_count"    SMALLINT     NOT NULL DEFAULT 0,
  "transaction_pin_hash"            VARCHAR(255),
  "transaction_pin_failed_attempts" SMALLINT     NOT NULL DEFAULT 0,
  "transaction_pin_locked_until"    TIMESTAMPTZ,
  "transaction_pin_hard_locked"     BOOLEAN      NOT NULL DEFAULT FALSE,
  "transaction_pin_lockout_count"   SMALLINT     NOT NULL DEFAULT 0,
  "argon2_params"                   VARCHAR(100) NOT NULL,
  "created_at"                      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updated_at"                      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "user_auth_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "user_auth_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "user_auth_user_id_key" UNIQUE ("user_id")
);

CREATE INDEX "user_auth_user_id_idx" ON "user_auth"("user_id");

-- -----------------------------------------------------------------------------
-- admins
-- -----------------------------------------------------------------------------
CREATE TABLE "admins" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "email"         VARCHAR(255) NOT NULL,
  "display_name"  VARCHAR(100) NOT NULL,
  "role"          "AdminRole"  NOT NULL DEFAULT 'admin',
  "passcode_hash" VARCHAR(255) NOT NULL,
  "argon2_params" VARCHAR(100) NOT NULL,
  "mfa_secret"    VARCHAR(255),
  "mfa_enabled"   BOOLEAN      NOT NULL DEFAULT FALSE,
  "is_active"     BOOLEAN      NOT NULL DEFAULT TRUE,
  "deleted_at"    TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "admins_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "admins_email_key" UNIQUE ("email")
);

CREATE INDEX "admins_email_idx"     ON "admins"("email");
CREATE INDEX "admins_role_idx"      ON "admins"("role");
CREATE INDEX "admins_is_active_idx" ON "admins"("is_active");

-- -----------------------------------------------------------------------------
-- admin_sessions
-- -----------------------------------------------------------------------------
CREATE TABLE "admin_sessions" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "admin_id"      UUID         NOT NULL,
  "refresh_token" VARCHAR(512) NOT NULL,
  "device_id"     VARCHAR(255) NOT NULL,
  "ip_address"    VARCHAR(45)  NOT NULL,
  "user_agent"    VARCHAR(512) NOT NULL,
  "is_revoked"    BOOLEAN      NOT NULL DEFAULT FALSE,
  "expires_at"    TIMESTAMPTZ  NOT NULL,
  "last_active"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "admin_sessions_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "admin_sessions_admin_fk"      FOREIGN KEY ("admin_id") REFERENCES "admins"("id"),
  CONSTRAINT "admin_sessions_token_key"     UNIQUE ("refresh_token")
);

CREATE INDEX "admin_sessions_admin_id_idx"      ON "admin_sessions"("admin_id");
CREATE INDEX "admin_sessions_refresh_token_idx" ON "admin_sessions"("refresh_token");
CREATE INDEX "admin_sessions_is_revoked_idx"    ON "admin_sessions"("is_revoked");

-- -----------------------------------------------------------------------------
-- wallets
-- NO balance column — balance is always derived from ledger_entries.
-- -----------------------------------------------------------------------------
CREATE TABLE "wallets" (
  "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID        NOT NULL,
  "deleted_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "wallets_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "wallets_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "wallets_user_id_key" UNIQUE ("user_id")
);

CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");

-- -----------------------------------------------------------------------------
-- transactions
-- Must exist before ledger_entries (FK dependency).
-- -----------------------------------------------------------------------------
CREATE TABLE "transactions" (
  "id"                 UUID               NOT NULL DEFAULT gen_random_uuid(),
  "type"               "TransactionType"  NOT NULL,
  "status"             "TransactionStatus" NOT NULL DEFAULT 'pending',
  "amount"             BIGINT             NOT NULL,
  "fee"                BIGINT             NOT NULL DEFAULT 0,
  "net_amount"         BIGINT             NOT NULL,
  "narration"          VARCHAR(255),
  "reference"          VARCHAR(64)        NOT NULL,
  "idempotency_key"    UUID               NOT NULL,
  "initiator_id"       UUID               NOT NULL,
  "initiator_type"     "InitiatorType"    NOT NULL,
  "sender_wallet_id"   UUID,
  "receiver_wallet_id" UUID,
  "metadata"           JSONB,
  "completed_at"       TIMESTAMPTZ,
  "deleted_at"         TIMESTAMPTZ,
  "created_at"         TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT "transactions_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "transactions_reference_key" UNIQUE ("reference"),
  CONSTRAINT "transactions_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "transactions_amount_check"  CHECK ("amount" > 0),
  CONSTRAINT "transactions_fee_check"     CHECK ("fee" >= 0)
);

CREATE INDEX "transactions_reference_idx"         ON "transactions"("reference");
CREATE INDEX "transactions_idempotency_key_idx"   ON "transactions"("idempotency_key");
CREATE INDEX "transactions_status_idx"            ON "transactions"("status");
CREATE INDEX "transactions_type_idx"              ON "transactions"("type");
CREATE INDEX "transactions_initiator_id_idx"      ON "transactions"("initiator_id");
CREATE INDEX "transactions_sender_wallet_id_idx"  ON "transactions"("sender_wallet_id");
CREATE INDEX "transactions_receiver_wallet_id_idx" ON "transactions"("receiver_wallet_id");
CREATE INDEX "transactions_created_at_idx"        ON "transactions"("created_at");
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");

-- -----------------------------------------------------------------------------
-- ledger_entries
-- APPEND-ONLY. The trigger below enforces this at the database level.
-- -----------------------------------------------------------------------------
CREATE TABLE "ledger_entries" (
  "id"             UUID              NOT NULL DEFAULT gen_random_uuid(),
  "wallet_id"      UUID              NOT NULL,
  "transaction_id" UUID              NOT NULL,
  "type"           "LedgerEntryType" NOT NULL,
  "amount"         BIGINT            NOT NULL,
  "created_at"     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  CONSTRAINT "ledger_entries_pkey"           PRIMARY KEY ("id"),
  CONSTRAINT "ledger_entries_wallet_fk"      FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id"),
  CONSTRAINT "ledger_entries_transaction_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id"),
  CONSTRAINT "ledger_entries_amount_check"   CHECK ("amount" > 0)
);

CREATE INDEX "ledger_entries_wallet_id_idx"        ON "ledger_entries"("wallet_id");
CREATE INDEX "ledger_entries_transaction_id_idx"   ON "ledger_entries"("transaction_id");
CREATE INDEX "ledger_entries_wallet_type_idx"      ON "ledger_entries"("wallet_id", "type");
CREATE INDEX "ledger_entries_created_at_idx"       ON "ledger_entries"("created_at");

-- =============================================================================
-- TRIGGER: enforce append-only on ledger_entries
-- Any UPDATE or DELETE raises an exception.
-- This is database-level enforcement — no application code can bypass it.
-- =============================================================================
CREATE OR REPLACE FUNCTION enforce_ledger_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries is append-only. UPDATE and DELETE are not permitted. '
    'Operation: %, Table: ledger_entries, Row ID: %',
    TG_OP,
    COALESCE(OLD.id::TEXT, 'unknown');
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutability_guard
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ledger_immutability();

-- -----------------------------------------------------------------------------
-- transaction_fees
-- -----------------------------------------------------------------------------
CREATE TABLE "transaction_fees" (
  "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
  "transaction_id" UUID         NOT NULL,
  "description"    VARCHAR(100) NOT NULL,
  "amount"         BIGINT       NOT NULL,
  "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "transaction_fees_pkey"           PRIMARY KEY ("id"),
  CONSTRAINT "transaction_fees_transaction_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id"),
  CONSTRAINT "transaction_fees_amount_check"   CHECK ("amount" > 0)
);

CREATE INDEX "transaction_fees_transaction_id_idx" ON "transaction_fees"("transaction_id");

-- -----------------------------------------------------------------------------
-- idempotency_keys
-- -----------------------------------------------------------------------------
CREATE TABLE "idempotency_keys" (
  "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
  "key"               UUID        NOT NULL,
  "user_id"           UUID        NOT NULL,
  "request_hash"      VARCHAR(64) NOT NULL,
  "response_snapshot" JSONB       NOT NULL,
  "status"            VARCHAR(20) NOT NULL DEFAULT 'pending',
  "transaction_id"    UUID,
  "expires_at"        TIMESTAMPTZ NOT NULL,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "idempotency_keys_pkey"           PRIMARY KEY ("id"),
  CONSTRAINT "idempotency_keys_key_key"         UNIQUE ("key"),
  CONSTRAINT "idempotency_keys_transaction_key" UNIQUE ("transaction_id")
);

CREATE INDEX "idempotency_keys_key_idx"        ON "idempotency_keys"("key");
CREATE INDEX "idempotency_keys_user_id_idx"    ON "idempotency_keys"("user_id");
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- -----------------------------------------------------------------------------
-- receipts
-- -----------------------------------------------------------------------------
CREATE TABLE "receipts" (
  "id"                   UUID          NOT NULL DEFAULT gen_random_uuid(),
  "transaction_id"       UUID          NOT NULL,
  "public_token"         UUID          NOT NULL DEFAULT gen_random_uuid(),
  "signed_url"           VARCHAR(2048),
  "signed_url_expires_at" TIMESTAMPTZ,
  "pdf_generated"        BOOLEAN       NOT NULL DEFAULT FALSE,
  "created_at"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "receipts_pkey"               PRIMARY KEY ("id"),
  CONSTRAINT "receipts_transaction_fk"     FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id"),
  CONSTRAINT "receipts_transaction_id_key" UNIQUE ("transaction_id"),
  CONSTRAINT "receipts_public_token_key"   UNIQUE ("public_token")
);

CREATE INDEX "receipts_transaction_id_idx" ON "receipts"("transaction_id");
CREATE INDEX "receipts_public_token_idx"   ON "receipts"("public_token");

-- -----------------------------------------------------------------------------
-- device_sessions
-- -----------------------------------------------------------------------------
CREATE TABLE "device_sessions" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"       UUID         NOT NULL,
  "device_id"     VARCHAR(255) NOT NULL,
  "refresh_token" VARCHAR(512) NOT NULL,
  "ip_address"    VARCHAR(45)  NOT NULL,
  "user_agent"    VARCHAR(512) NOT NULL,
  "is_revoked"    BOOLEAN      NOT NULL DEFAULT FALSE,
  "expires_at"    TIMESTAMPTZ  NOT NULL,
  "last_active"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "device_sessions_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "device_sessions_user_fk"    FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "device_sessions_token_key"  UNIQUE ("refresh_token")
);

CREATE INDEX "device_sessions_user_id_idx"      ON "device_sessions"("user_id");
CREATE INDEX "device_sessions_device_id_idx"    ON "device_sessions"("device_id");
CREATE INDEX "device_sessions_refresh_token_idx" ON "device_sessions"("refresh_token");
CREATE INDEX "device_sessions_user_device_idx"  ON "device_sessions"("user_id", "device_id");
CREATE INDEX "device_sessions_is_revoked_idx"   ON "device_sessions"("is_revoked");
CREATE INDEX "device_sessions_expires_at_idx"   ON "device_sessions"("expires_at");

-- -----------------------------------------------------------------------------
-- kyc_attempts
-- -----------------------------------------------------------------------------
CREATE TABLE "kyc_attempts" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"          UUID         NOT NULL,
  "tier_target"      SMALLINT     NOT NULL,
  "status"           "KycStatus"  NOT NULL DEFAULT 'pending',
  "failure_reason"   VARCHAR(255),
  "metadata"         JSONB,
  "cooldown_until"   TIMESTAMPTZ,
  "is_admin_override" BOOLEAN     NOT NULL DEFAULT FALSE,
  "overridden_by"    UUID,
  "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "kyc_attempts_pkey"        PRIMARY KEY ("id"),
  CONSTRAINT "kyc_attempts_user_fk"     FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "kyc_attempts_admin_fk"    FOREIGN KEY ("overridden_by") REFERENCES "admins"("id"),
  CONSTRAINT "kyc_attempts_tier_check"  CHECK ("tier_target" IN (1, 2, 3))
);

CREATE INDEX "kyc_attempts_user_id_idx"        ON "kyc_attempts"("user_id");
CREATE INDEX "kyc_attempts_status_idx"         ON "kyc_attempts"("status");
CREATE INDEX "kyc_attempts_user_tier_idx"      ON "kyc_attempts"("user_id", "tier_target");
CREATE INDEX "kyc_attempts_created_at_idx"     ON "kyc_attempts"("created_at");

-- -----------------------------------------------------------------------------
-- beneficiaries
-- -----------------------------------------------------------------------------
CREATE TABLE "beneficiaries" (
  "id"                  UUID              NOT NULL DEFAULT gen_random_uuid(),
  "user_id"             UUID              NOT NULL,
  "type"                "BeneficiaryType" NOT NULL,
  "recipient_user_id"   UUID,
  "recipient_name"      VARCHAR(100),
  "bank_code"           VARCHAR(10),
  "bank_name"           VARCHAR(100),
  "account_number"      VARCHAR(512),
  "account_name"        VARCHAR(100),
  "account_verified"    BOOLEAN           NOT NULL DEFAULT FALSE,
  "account_verified_at" TIMESTAMPTZ,
  "nickname"            VARCHAR(50),
  "deleted_at"          TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  CONSTRAINT "beneficiaries_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "beneficiaries_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);

CREATE INDEX "beneficiaries_user_id_idx"      ON "beneficiaries"("user_id");
CREATE INDEX "beneficiaries_user_type_idx"    ON "beneficiaries"("user_id", "type");
CREATE INDEX "beneficiaries_deleted_at_idx"   ON "beneficiaries"("deleted_at");

-- -----------------------------------------------------------------------------
-- payment_requests
-- -----------------------------------------------------------------------------
CREATE TABLE "payment_requests" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "sender_id"   UUID        NOT NULL,
  "receiver_id" UUID        NOT NULL,
  "amount"      BIGINT      NOT NULL,
  "narration"   VARCHAR(255),
  "status"      VARCHAR(20) NOT NULL DEFAULT 'pending',
  "expires_at"  TIMESTAMPTZ NOT NULL,
  "paid_at"     TIMESTAMPTZ,
  "deleted_at"  TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "payment_requests_pkey"        PRIMARY KEY ("id"),
  CONSTRAINT "payment_requests_sender_fk"   FOREIGN KEY ("sender_id") REFERENCES "users"("id"),
  CONSTRAINT "payment_requests_receiver_fk" FOREIGN KEY ("receiver_id") REFERENCES "users"("id"),
  CONSTRAINT "payment_requests_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payment_requests_status_check" CHECK ("status" IN ('pending','paid','declined','expired','cancelled'))
);

CREATE INDEX "payment_requests_sender_id_idx"   ON "payment_requests"("sender_id");
CREATE INDEX "payment_requests_receiver_id_idx" ON "payment_requests"("receiver_id");
CREATE INDEX "payment_requests_status_idx"      ON "payment_requests"("status");
CREATE INDEX "payment_requests_expires_at_idx"  ON "payment_requests"("expires_at");

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
CREATE TABLE "notifications" (
  "id"             UUID                  NOT NULL DEFAULT gen_random_uuid(),
  "user_id"        UUID                  NOT NULL,
  "channel"        "NotificationChannel" NOT NULL,
  "status"         "NotificationStatus"  NOT NULL DEFAULT 'pending',
  "event_type"     VARCHAR(50)           NOT NULL,
  "title"          VARCHAR(255)          NOT NULL,
  "body"           TEXT                  NOT NULL,
  "metadata"       JSONB,
  "attempts"       SMALLINT              NOT NULL DEFAULT 0,
  "last_attempted" TIMESTAMPTZ,
  "delivered_at"   TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  CONSTRAINT "notifications_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "notifications_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);

CREATE INDEX "notifications_user_id_idx"    ON "notifications"("user_id");
CREATE INDEX "notifications_status_idx"     ON "notifications"("status");
CREATE INDEX "notifications_channel_idx"    ON "notifications"("channel");
CREATE INDEX "notifications_event_type_idx" ON "notifications"("event_type");
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- -----------------------------------------------------------------------------
-- notification_prefs
-- -----------------------------------------------------------------------------
CREATE TABLE "notification_prefs" (
  "id"                 UUID        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"            UUID        NOT NULL,
  "push_transactions"  BOOLEAN     NOT NULL DEFAULT TRUE,
  "email_transactions" BOOLEAN     NOT NULL DEFAULT TRUE,
  "sms_transactions"   BOOLEAN     NOT NULL DEFAULT FALSE,
  "push_marketing"     BOOLEAN     NOT NULL DEFAULT FALSE,
  "email_marketing"    BOOLEAN     NOT NULL DEFAULT FALSE,
  "push_security"      BOOLEAN     NOT NULL DEFAULT TRUE,
  "email_security"     BOOLEAN     NOT NULL DEFAULT TRUE,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "notification_prefs_pkey"        PRIMARY KEY ("id"),
  CONSTRAINT "notification_prefs_user_fk"     FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "notification_prefs_user_id_key" UNIQUE ("user_id")
);

CREATE INDEX "notification_prefs_user_id_idx" ON "notification_prefs"("user_id");

-- -----------------------------------------------------------------------------
-- conversations
-- -----------------------------------------------------------------------------
CREATE TABLE "conversations" (
  "id"           UUID               NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID               NOT NULL,
  "status"       "BotSessionStatus" NOT NULL DEFAULT 'active',
  "state"        "BotState"         NOT NULL DEFAULT 'idle',
  "intent_count" SMALLINT           NOT NULL DEFAULT 0,
  "messages"     JSONB              NOT NULL DEFAULT '[]',
  "context"      JSONB,
  "expires_at"   TIMESTAMPTZ        NOT NULL,
  "ended_at"     TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT "conversations_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "conversations_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);

CREATE INDEX "conversations_user_id_idx"  ON "conversations"("user_id");
CREATE INDEX "conversations_status_idx"   ON "conversations"("status");
CREATE INDEX "conversations_expires_at_idx" ON "conversations"("expires_at");

-- -----------------------------------------------------------------------------
-- webhooks
-- -----------------------------------------------------------------------------
CREATE TABLE "webhooks" (
  "id"                UUID                     NOT NULL DEFAULT gen_random_uuid(),
  "provider"          VARCHAR(50)              NOT NULL,
  "webhook_id"        VARCHAR(255)             NOT NULL,
  "event_type"        VARCHAR(100)             NOT NULL,
  "hmac_verified"     BOOLEAN                  NOT NULL,
  "processing_status" "WebhookProcessingStatus" NOT NULL DEFAULT 'queued',
  "payload_hash"      VARCHAR(64)              NOT NULL,
  "error_message"     TEXT,
  "created_at"        TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ              NOT NULL DEFAULT NOW(),

  CONSTRAINT "webhooks_pkey"                    PRIMARY KEY ("id"),
  CONSTRAINT "webhooks_provider_webhook_id_key" UNIQUE ("provider", "webhook_id")
);

CREATE INDEX "webhooks_provider_idx"           ON "webhooks"("provider");
CREATE INDEX "webhooks_processing_status_idx"  ON "webhooks"("processing_status");
CREATE INDEX "webhooks_created_at_idx"         ON "webhooks"("created_at");

-- -----------------------------------------------------------------------------
-- disputes
-- -----------------------------------------------------------------------------
CREATE TABLE "disputes" (
  "id"              UUID            NOT NULL DEFAULT gen_random_uuid(),
  "user_id"         UUID            NOT NULL,
  "transaction_id"  UUID            NOT NULL,
  "status"          "DisputeStatus" NOT NULL DEFAULT 'open',
  "reason_category" VARCHAR(50)     NOT NULL,
  "description"     TEXT            NOT NULL,
  "resolution_note" TEXT,
  "resolved_by"     UUID,
  "resolved_at"     TIMESTAMPTZ,
  "deleted_at"      TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT "disputes_pkey"           PRIMARY KEY ("id"),
  CONSTRAINT "disputes_user_fk"        FOREIGN KEY ("user_id") REFERENCES "users"("id"),
  CONSTRAINT "disputes_transaction_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id"),
  CONSTRAINT "disputes_transaction_id_key" UNIQUE ("transaction_id")
);

CREATE INDEX "disputes_user_id_idx"       ON "disputes"("user_id");
CREATE INDEX "disputes_transaction_id_idx" ON "disputes"("transaction_id");
CREATE INDEX "disputes_status_idx"        ON "disputes"("status");
CREATE INDEX "disputes_created_at_idx"    ON "disputes"("created_at");

-- -----------------------------------------------------------------------------
-- reversals
-- -----------------------------------------------------------------------------
CREATE TABLE "reversals" (
  "id"                      UUID        NOT NULL DEFAULT gen_random_uuid(),
  "original_transaction_id" UUID        NOT NULL,
  "reversal_transaction_id" UUID        NOT NULL,
  "admin_id"                UUID        NOT NULL,
  "reason_code"             VARCHAR(50) NOT NULL,
  "note"                    TEXT        NOT NULL,
  "created_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "reversals_pkey"                        PRIMARY KEY ("id"),
  CONSTRAINT "reversals_original_transaction_fk"     FOREIGN KEY ("original_transaction_id") REFERENCES "transactions"("id"),
  CONSTRAINT "reversals_reversal_transaction_fk"     FOREIGN KEY ("reversal_transaction_id") REFERENCES "transactions"("id"),
  CONSTRAINT "reversals_admin_fk"                    FOREIGN KEY ("admin_id") REFERENCES "admins"("id"),
  CONSTRAINT "reversals_original_transaction_id_key" UNIQUE ("original_transaction_id"),
  CONSTRAINT "reversals_reversal_transaction_id_key" UNIQUE ("reversal_transaction_id")
);

CREATE INDEX "reversals_original_transaction_id_idx" ON "reversals"("original_transaction_id");
CREATE INDEX "reversals_admin_id_idx"                ON "reversals"("admin_id");

-- -----------------------------------------------------------------------------
-- admin_actions
-- -----------------------------------------------------------------------------
CREATE TABLE "admin_actions" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "admin_id"    UUID        NOT NULL,
  "action"      VARCHAR(100) NOT NULL,
  "target_type" VARCHAR(50) NOT NULL,
  "target_id"   UUID        NOT NULL,
  "reason"      TEXT,
  "metadata"    JSONB,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "admin_actions_pkey"     PRIMARY KEY ("id"),
  CONSTRAINT "admin_actions_admin_fk" FOREIGN KEY ("admin_id") REFERENCES "admins"("id")
);

CREATE INDEX "admin_actions_admin_id_idx"  ON "admin_actions"("admin_id");
CREATE INDEX "admin_actions_action_idx"    ON "admin_actions"("action");
CREATE INDEX "admin_actions_target_id_idx" ON "admin_actions"("target_id");
CREATE INDEX "admin_actions_created_at_idx" ON "admin_actions"("created_at");

-- -----------------------------------------------------------------------------
-- qr_codes
-- -----------------------------------------------------------------------------
CREATE TABLE "qr_codes" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID         NOT NULL,
  "type"       "QrCodeType" NOT NULL,
  "amount"     BIGINT,
  "narration"  VARCHAR(255),
  "payload"    TEXT         NOT NULL,
  "hmac_sig"   VARCHAR(128) NOT NULL,
  "expires_at" TIMESTAMPTZ,
  "is_active"  BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "qr_codes_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "qr_codes_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);

CREATE INDEX "qr_codes_user_id_idx"   ON "qr_codes"("user_id");
CREATE INDEX "qr_codes_is_active_idx" ON "qr_codes"("is_active");
CREATE INDEX "qr_codes_expires_at_idx" ON "qr_codes"("expires_at");

-- -----------------------------------------------------------------------------
-- audit_logs
-- APPEND-ONLY. The trigger below enforces this at the database level.
-- Hash-chained for tamper detection.
-- -----------------------------------------------------------------------------
CREATE TABLE "audit_logs" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  "actor_id"      UUID,
  "actor_type"    VARCHAR(20) NOT NULL,
  "action"        VARCHAR(100) NOT NULL,
  "target_type"   VARCHAR(50),
  "target_id"     UUID,
  "metadata"      JSONB,
  "ip_address"    VARCHAR(45),
  "previous_hash" VARCHAR(64) NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "audit_logs_pkey"     PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_actor_check" CHECK ("actor_type" IN ('user', 'admin', 'system'))
);

CREATE INDEX "audit_logs_actor_id_idx"   ON "audit_logs"("actor_id");
CREATE INDEX "audit_logs_action_idx"     ON "audit_logs"("action");
CREATE INDEX "audit_logs_target_id_idx"  ON "audit_logs"("target_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- =============================================================================
-- TRIGGER: enforce append-only on audit_logs
-- =============================================================================
CREATE OR REPLACE FUNCTION enforce_audit_log_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only. UPDATE and DELETE are not permitted. '
    'Operation: %, Table: audit_logs, Row ID: %',
    TG_OP,
    COALESCE(OLD.id::TEXT, 'unknown');
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutability_guard
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_audit_log_immutability();

-- =============================================================================
-- FUNCTION: verify audit log hash chain integrity
-- Call this from a reconciliation job or admin integrity check.
-- Returns rows where the chain is broken.
-- =============================================================================
CREATE OR REPLACE FUNCTION verify_audit_log_chain()
RETURNS TABLE (
  broken_entry_id   UUID,
  expected_hash     TEXT,
  stored_hash       TEXT,
  previous_entry_id UUID
) AS $$
BEGIN
  RETURN QUERY
  WITH ordered_logs AS (
    SELECT
      id,
      previous_hash,
      LAG(id)         OVER (ORDER BY created_at, id) AS prev_id,
      LAG(created_at) OVER (ORDER BY created_at, id) AS prev_created_at
    FROM audit_logs
  )
  SELECT
    ol.id,
    CASE
      WHEN ol.prev_id IS NULL THEN 'GENESIS'
      ELSE encode(
        digest(ol.prev_id::TEXT || ol.prev_created_at::TEXT, 'sha256'),
        'hex'
      )
    END AS expected,
    ol.previous_hash AS stored,
    ol.prev_id
  FROM ordered_logs ol
  WHERE
    ol.previous_hash != CASE
      WHEN ol.prev_id IS NULL THEN 'GENESIS'
      ELSE encode(
        digest(ol.prev_id::TEXT || ol.prev_created_at::TEXT, 'sha256'),
        'hex'
      )
    END;
END;
$$ LANGUAGE plpgsql;
