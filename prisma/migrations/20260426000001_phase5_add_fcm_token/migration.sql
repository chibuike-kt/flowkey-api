-- =============================================================================
-- FLOWKEY — MIGRATION: 20260425000001_phase5_add_fcm_token
-- Phase 5: Add fcm_token to device_sessions
-- =============================================================================
--
-- ROLLBACK STRATEGY:
--   ALTER TABLE "device_sessions" DROP COLUMN IF EXISTS "fcm_token";
--
-- WHY:
--   FCM token is sent by the client at login and registration.
--   Stored on the session so the notification service can target the
--   correct device for push delivery without a separate lookup.
--   Nullable because admin sessions do not have FCM tokens.
-- =============================================================================

ALTER TABLE "device_sessions"
  ADD COLUMN "fcm_token" VARCHAR(512);

CREATE INDEX "device_sessions_fcm_token_idx" ON "device_sessions"("fcm_token")
  WHERE "fcm_token" IS NOT NULL;
