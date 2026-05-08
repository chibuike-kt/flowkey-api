import { z } from 'zod';

export const ResolveRecipientSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .max(50, 'Identifier too long')
    .describe('Username (e.g. kingsley_kt) or Universal ID (e.g. BOLT-KP-4821)'),
});

export const InternalTransferSchema = z.object({
  recipient_wallet_id: z.string().uuid('recipient_wallet_id must be a UUID'),
  amount_kobo: z.number().int('Amount must be an integer').positive('Amount must be positive'),
  narration: z.string().max(255).optional(),
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

export type ResolveRecipientInput = z.infer<typeof ResolveRecipientSchema>;
export type InternalTransferInput = z.infer<typeof InternalTransferSchema>;
