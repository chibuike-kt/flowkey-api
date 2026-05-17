-- Make initiator_id nullable on transactions
-- System-initiated operations (virtual account credits, reversals, test deposits)
-- have no user initiator — previously used a nil UUID which violated the FK constraint.

ALTER TABLE "transactions" ALTER COLUMN "initiator_id" DROP NOT NULL;
