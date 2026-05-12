import { z } from 'zod';

// ---------------------------------------------------------------------------
// Card management
// ---------------------------------------------------------------------------

export const AddCardSchema = z.object({
  // Authorization code from Paystack SDK after first charge
  authorization_code: z.string().min(1, 'Authorization code is required'),
  // Client passes these from the SDK response so we don't need to call Paystack
  // to retrieve them — but we still verify the auth_code is real on our end
  last4: z.string().regex(/^\d{4}$/, 'last4 must be exactly 4 digits'),
  card_type: z.string().min(1).max(20),
  bank: z.string().min(1).max(100),
  expiry_month: z.string().regex(/^(0[1-9]|1[0-2])$/, 'expiry_month must be 01–12'),
  expiry_year: z.string().regex(/^\d{4}$/, 'expiry_year must be 4 digits'),
  // Optional: mark as default card immediately
  set_as_default: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Card deposit
// ---------------------------------------------------------------------------

export const CardDepositSchema = z.object({
  card_id: z.string().uuid('card_id must be a UUID'),
  amount_kobo: z
    .number()
    .int('Amount must be an integer')
    .positive('Amount must be positive')
    .min(10_000, 'Minimum deposit is ₦100')
    .max(500_000_000_00, 'Amount exceeds maximum'),
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

// ---------------------------------------------------------------------------
// List deposits
// ---------------------------------------------------------------------------

export const ListDepositsSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  channel: z.enum(['virtual_account', 'card', 'all']).default('all'),
  status: z.enum(['pending', 'completed', 'failed']).optional(),
});

export type AddCardInput = z.infer<typeof AddCardSchema>;
export type CardDepositInput = z.infer<typeof CardDepositSchema>;
export type ListDepositsInput = z.infer<typeof ListDepositsSchema>;
