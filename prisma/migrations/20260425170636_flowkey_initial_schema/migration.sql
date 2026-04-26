-- DropForeignKey
ALTER TABLE "admin_actions" DROP CONSTRAINT "admin_actions_admin_fk";

-- DropForeignKey
ALTER TABLE "admin_sessions" DROP CONSTRAINT "admin_sessions_admin_fk";

-- DropForeignKey
ALTER TABLE "beneficiaries" DROP CONSTRAINT "beneficiaries_user_fk";

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_user_fk";

-- DropForeignKey
ALTER TABLE "device_sessions" DROP CONSTRAINT "device_sessions_user_fk";

-- DropForeignKey
ALTER TABLE "disputes" DROP CONSTRAINT "disputes_transaction_fk";

-- DropForeignKey
ALTER TABLE "disputes" DROP CONSTRAINT "disputes_user_fk";

-- DropForeignKey
ALTER TABLE "kyc_attempts" DROP CONSTRAINT "kyc_attempts_admin_fk";

-- DropForeignKey
ALTER TABLE "kyc_attempts" DROP CONSTRAINT "kyc_attempts_user_fk";

-- DropForeignKey
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_transaction_fk";

-- DropForeignKey
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_wallet_fk";

-- DropForeignKey
ALTER TABLE "notification_prefs" DROP CONSTRAINT "notification_prefs_user_fk";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_fk";

-- DropForeignKey
ALTER TABLE "payment_requests" DROP CONSTRAINT "payment_requests_receiver_fk";

-- DropForeignKey
ALTER TABLE "payment_requests" DROP CONSTRAINT "payment_requests_sender_fk";

-- DropForeignKey
ALTER TABLE "qr_codes" DROP CONSTRAINT "qr_codes_user_fk";

-- DropForeignKey
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_transaction_fk";

-- DropForeignKey
ALTER TABLE "reversals" DROP CONSTRAINT "reversals_admin_fk";

-- DropForeignKey
ALTER TABLE "reversals" DROP CONSTRAINT "reversals_original_transaction_fk";

-- DropForeignKey
ALTER TABLE "reversals" DROP CONSTRAINT "reversals_reversal_transaction_fk";

-- DropForeignKey
ALTER TABLE "transaction_fees" DROP CONSTRAINT "transaction_fees_transaction_fk";

-- DropForeignKey
ALTER TABLE "user_auth" DROP CONSTRAINT "user_auth_user_fk";

-- DropForeignKey
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_user_fk";

-- AlterTable
ALTER TABLE "admins" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "beneficiaries" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "disputes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "idempotency_keys" ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "kyc_attempts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notification_prefs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payment_requests" ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "receipts" ALTER COLUMN "public_token" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_auth" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "wallets" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "webhooks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "user_auth" ADD CONSTRAINT "user_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_initiator_user_fk" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_fees" ADD CONSTRAINT "transaction_fees_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_attempts" ADD CONSTRAINT "kyc_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_attempts" ADD CONSTRAINT "kyc_attempts_overridden_by_fkey" FOREIGN KEY ("overridden_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversals" ADD CONSTRAINT "reversals_original_transaction_id_fkey" FOREIGN KEY ("original_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversals" ADD CONSTRAINT "reversals_reversal_transaction_id_fkey" FOREIGN KEY ("reversal_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversals" ADD CONSTRAINT "reversals_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "admin_sessions_token_key" RENAME TO "admin_sessions_refresh_token_key";

-- RenameIndex
ALTER INDEX "beneficiaries_user_type_idx" RENAME TO "beneficiaries_user_id_type_idx";

-- RenameIndex
ALTER INDEX "device_sessions_token_key" RENAME TO "device_sessions_refresh_token_key";

-- RenameIndex
ALTER INDEX "device_sessions_user_device_idx" RENAME TO "device_sessions_user_id_device_id_idx";

-- RenameIndex
ALTER INDEX "idempotency_keys_transaction_key" RENAME TO "idempotency_keys_transaction_id_key";

-- RenameIndex
ALTER INDEX "kyc_attempts_user_tier_idx" RENAME TO "kyc_attempts_user_id_tier_target_idx";

-- RenameIndex
ALTER INDEX "ledger_entries_wallet_type_idx" RENAME TO "ledger_entries_wallet_id_type_idx";
