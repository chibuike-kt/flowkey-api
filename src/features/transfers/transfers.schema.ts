import { z } from 'zod';

export const ResolveRecipientSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .max(50, 'Identifier too long')
    .describe('Username or Universal ID (e.g. BOLT-KP-4821)'),
});

export const InternalTransferSchema = z
  .object({
    recipient_wallet_id: z.string().uuid('recipient_wallet_id must be a UUID'),

    amount_kobo: z
      .number()
      .int('Amount must be an integer')
      .positive('Amount must be positive')
      .max(500_000_000_00, 'Amount exceeds single-transfer maximum'), // ₦5bn cap

    narration: z.string().max(255).optional(),

    pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),

    source: z.enum(['username', 'qr_code', 'universal_id', 'api']).default('username'),

    // UID auth fields — only required when source = 'universal_id'
    uid_identifier: z.string().max(50).optional(),

    // For QR — the QR token the client decoded
    qr_token: z.string().uuid().optional(),

    // Device fingerprint — logged for chargeback evidence, never blocked on
    device_id: z.string().max(255).optional(),
  })
  .refine((d) => d.source !== 'universal_id' || !!d.uid_identifier, {
    message: 'uid_identifier is required when source is universal_id',
    path: ['uid_identifier'],
  });

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


export const ListTransfersSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: z.enum(['internal', 'bank', 'all']).default('all'),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'reversed']).optional(),
  direction: z.enum(['sent', 'received', 'all']).default('all'),
});

export const RetryTransferSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

export type ResolveRecipientInput = z.infer<typeof ResolveRecipientSchema>;
export type InternalTransferInput = z.infer<typeof InternalTransferSchema>;
export type BankTransferInput = z.infer<typeof BankTransferSchema>;
export type ListTransfersInput = z.infer<typeof ListTransfersSchema>;
export type RetryTransferInput = z.infer<typeof RetryTransferSchema>;
