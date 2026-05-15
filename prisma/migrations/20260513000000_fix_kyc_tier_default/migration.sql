-- Fix KYC tier: change default from 0 to 1 and update existing tier-0 users
-- Tier 1 is the baseline for all registered users — tier 0 was never a valid state.

-- Update check constraint to reflect 1-3 range
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_kyc_tier_check";
ALTER TABLE "users" ADD CONSTRAINT "users_kyc_tier_check" CHECK ("kyc_tier" >= 1 AND "kyc_tier" <= 3);

-- Update column default
ALTER TABLE "users" ALTER COLUMN "kyc_tier" SET DEFAULT 1;

-- Migrate any existing tier-0 users to tier 1
UPDATE "users" SET "kyc_tier" = 1 WHERE "kyc_tier" = 0;
