import { z } from 'zod';

const DEFAULT_EXPIRY_HOURS = 24;
const MAX_EXPIRY_HOURS = 72;

export const CreatePaymentRequestSchema = z.object({
  // Receiver identified by wallet_id, username, or universal_id
  receiver_identifier: z.string().min(1, 'Receiver is required'),

  amount_kobo: z
    .number()
    .int('Amount must be an integer')
    .positive('Amount must be positive')
    .min(100, 'Minimum request amount is ₦1 (100 kobo)')
    .max(500_000_000_00, 'Amount exceeds maximum'),

  narration: z.string().max(255).optional(),

  // How many hours until the request expires. Default 24h, max 72h.
  expires_in_hours: z
    .number()
    .int()
    .min(1)
    .max(MAX_EXPIRY_HOURS)
    .default(DEFAULT_EXPIRY_HOURS)
    .optional(),
});

export const PayPaymentRequestSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

export const ListPaymentRequestsSchema = z.object({
  direction: z.enum(['sent', 'received', 'all']).default('all'),
  status: z.enum(['pending', 'paid', 'declined', 'cancelled', 'expired']).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreatePaymentRequestInput = z.infer<typeof CreatePaymentRequestSchema>;
export type PayPaymentRequestInput = z.infer<typeof PayPaymentRequestSchema>;
export type ListPaymentRequestsInput = z.infer<typeof ListPaymentRequestsSchema>;
