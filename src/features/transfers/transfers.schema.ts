/**
 * FlowKey — Transfer Zod Schemas
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Resolve recipient
// ---------------------------------------------------------------------------

export const ResolveRecipientSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .max(50, 'Identifier too long')
    .describe('Username or Universal ID (e.g. BOLT-KP-4821)'),
});

// ---------------------------------------------------------------------------
// Internal transfer (FlowKey → FlowKey)
// ---------------------------------------------------------------------------

export const InternalTransferSchema = z.object({
  // Recipient identified by their wallet_id (from resolve-recipient)
  recipient_wallet_id: z.string().uuid('recipient_wallet_id must be a UUID'),

  amount_kobo: z
    .number()
    .int('Amount must be an integer')
    .positive('Amount must be positive')
    .max(500_000_000_00, 'Amount exceeds single-transfer maximum'),

  narration: z.string().max(255).optional(),

  // Transaction PIN — 4-digit, set in FlowKey app settings
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),

  // How the recipient was found — logged for analytics, not a security control
  source: z.enum(['username', 'qr_code', 'api']).default('username'),

  // QR token — only present when source = qr_code
  qr_token: z.string().uuid().optional(),

  device_id: z.string().max(255).optional(),
});

// ---------------------------------------------------------------------------
// UID transfer — 3rd party app initiated (no FlowKey session required)
// ---------------------------------------------------------------------------

// User presents their Universal ID + UPP on the 3rd party app.
// The 3rd party calls these endpoints — no Bearer token needed.
// UPP (Universal Payment PIN, 6-digit) authenticates instead of session PIN.

export const UidInternalTransferSchema = z.object({
  // The payer's Universal ID (e.g. RIVER-CLOUD-SEVEN)
  universal_id: z.string().min(1, 'Universal ID is required'),

  // Universal Payment PIN — 6-digit
  upp: z.string().regex(/^\d{6}$/, 'UPP must be exactly 6 digits'),

  // Recipient — FlowKey wallet
  recipient_wallet_id: z.string().uuid('recipient_wallet_id must be a UUID'),

  amount_kobo: z
    .number()
    .int('Amount must be an integer')
    .positive('Amount must be positive')
    .max(500_000_000_00, 'Amount exceeds single-transfer maximum'),

  narration: z.string().max(255).optional(),
});

export const UidBankTransferSchema = z.object({
  // The payer's Universal ID
  universal_id: z.string().min(1, 'Universal ID is required'),

  // Universal Payment PIN — 6-digit
  upp: z.string().regex(/^\d{6}$/, 'UPP must be exactly 6 digits'),

  // Recipient bank account
  bank_code: z.string().min(3).max(10),
  account_number: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  account_name: z.string().min(2).max(100),
  bank_name: z.string().min(2).max(100),
  verified_account_name: z.string().min(2).max(100),

  amount_kobo: z
    .number()
    .int('Amount must be an integer')
    .positive('Amount must be positive')
    .max(500_000_000_00, 'Amount exceeds single-transfer maximum'),

  narration: z.string().max(255).optional(),
});

// ---------------------------------------------------------------------------
// Bank transfer (FlowKey → Bank)
// ---------------------------------------------------------------------------

export const BankTransferSchema = z.object({
  amount_kobo: z
    .number()
    .int('Amount must be an integer')
    .positive('Amount must be positive')
    .max(500_000_000_00, 'Amount exceeds single-transfer maximum'),

  narration: z.string().max(255).optional(),

  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),

  // Recipient bank account
  bank_code: z.string().min(3).max(10, 'Invalid bank code'),
  account_number: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  account_name: z.string().min(2).max(100, 'Account name too long'),
  bank_name: z.string().min(2).max(100, 'Bank name too long'),

  // Client verifies account name before submitting — we store what they confirmed
  verified_account_name: z.string().min(2).max(100),

  device_id: z.string().max(255).optional(),
});

// ---------------------------------------------------------------------------
// List transfers (GET /transfers)
// ---------------------------------------------------------------------------

export const ListTransfersSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: z.enum(['internal', 'bank', 'all']).default('all'),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'reversed']).optional(),
  direction: z.enum(['sent', 'received', 'all']).default('all'),
});

// ---------------------------------------------------------------------------
// Retry failed bank transfer
// ---------------------------------------------------------------------------

export const RetryTransferSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

export type ResolveRecipientInput = z.infer<typeof ResolveRecipientSchema>;
export type InternalTransferInput = z.infer<typeof InternalTransferSchema>;
export type BankTransferInput = z.infer<typeof BankTransferSchema>;
export type ListTransfersInput = z.infer<typeof ListTransfersSchema>;
export type RetryTransferInput = z.infer<typeof RetryTransferSchema>;
export type UidInternalTransferInput = z.infer<typeof UidInternalTransferSchema>;
export type UidBankTransferInput = z.infer<typeof UidBankTransferSchema>;
