-- =============================================================================
-- FLOWKEY — MIGRATION: 20260426000000_phase5_auth_redesign
-- Phase 5 Auth Redesign
-- =============================================================================
--
-- WHAT THIS MIGRATION DOES:
--   1. Adds username to users table (unique, indexed)
--   2. Adds universal_id_revoked_at to users table (rate limit tracking)
--   3. Adds registration_channel to users (phone | email)
--   4. Adds registration_step to users (tracks multi-step registration)
--   5. Adds UPP (Universal Payment PIN) fields to user_auth
--   6. Creates universal_id_history table (retired IDs never reassigned)
--   7. Drops display_name NOT NULL constraint (now optional, set in profile)
--
-- ROLLBACK STRATEGY:
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "username";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "universal_id_revoked_at";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "registration_channel";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "registration_step";
--   ALTER TABLE "user_auth" DROP COLUMN IF EXISTS "upp_hash";
--   ALTER TABLE "user_auth" DROP COLUMN IF EXISTS "upp_failed_attempts";
--   ALTER TABLE "user_auth" DROP COLUMN IF EXISTS "upp_locked_until";
--   ALTER TABLE "user_auth" DROP COLUMN IF EXISTS "upp_hard_locked";
--   ALTER TABLE "user_auth" DROP COLUMN IF EXISTS "upp_lockout_count";
--   DROP TABLE IF EXISTS "universal_id_history";
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add username to users
-- -----------------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN "username" VARCHAR(30) UNIQUE,
  ADD COLUMN "universal_id_revoked_at" TIMESTAMPTZ,
  ADD COLUMN "registration_channel" VARCHAR(10),   -- 'phone' | 'email'
  ADD COLUMN "registration_step" VARCHAR(30)        -- 'otp_pending' | 'otp_verified' | 'active'
  DEFAULT 'otp_pending';

-- Make display_name optional (was implicitly required)
ALTER TABLE "users"
  ALTER COLUMN "display_name" DROP NOT NULL,
  ALTER COLUMN "display_name" SET DEFAULT '';

CREATE INDEX "users_username_idx" ON "users"("username")
  WHERE "username" IS NOT NULL;

CREATE INDEX "users_registration_step_idx" ON "users"("registration_step");

-- -----------------------------------------------------------------------------
-- 2. Add UPP fields to user_auth
-- Universal Payment PIN — authorises payments via Universal ID on foreign device
-- Separate from login passcode (6-digit) and transaction PIN (4-digit)
-- UPP is also 6-digit
-- -----------------------------------------------------------------------------
ALTER TABLE "user_auth"
  ADD COLUMN "upp_hash"              VARCHAR(255),    -- Argon2id hash, nullable until set
  ADD COLUMN "upp_failed_attempts"   SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN "upp_locked_until"      TIMESTAMPTZ,
  ADD COLUMN "upp_hard_locked"       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "upp_lockout_count"     SMALLINT NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 3. universal_id_history — retired Universal IDs
-- Never reassigned. Permanent record of all IDs a user has held.
-- -----------------------------------------------------------------------------
CREATE TABLE "universal_id_history" (
  "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"         UUID        NOT NULL,
  "universal_id"    VARCHAR(20) NOT NULL,
  "revoked_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "revoked_reason"  VARCHAR(50) NOT NULL DEFAULT 'user_requested',

  CONSTRAINT "universal_id_history_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "universal_id_history_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id"),
  -- Guarantee uniqueness across history — an ID can never appear twice in history
  CONSTRAINT "universal_id_history_uid_key" UNIQUE ("universal_id")
);

CREATE INDEX "universal_id_history_user_id_idx" ON "universal_id_history"("user_id");
CREATE INDEX "universal_id_history_uid_idx"     ON "universal_id_history"("universal_id");
