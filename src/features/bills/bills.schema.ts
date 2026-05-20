import { z } from 'zod';

// ---------------------------------------------------------------------------
// Airtime
// ---------------------------------------------------------------------------

export const BuyAirtimeSchema = z.object({
  network: z.enum(['mtn', 'airtel', 'glo', '9mobile']),
  phone: z.string().regex(/^\+?[0-9]{10,14}$/, 'Invalid phone number'),
  amount_kobo: z
    .number()
    .int('Amount must be an integer')
    .min(5000, 'Minimum airtime is ₦50')
    .max(5_000_000, 'Maximum airtime is ₦50,000 per transaction'),
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export const GetDataPlansSchema = z.object({
  network: z.enum(['mtn', 'airtel', 'glo', '9mobile']),
});

export const BuyDataSchema = z.object({
  network: z.enum(['mtn', 'airtel', 'glo', '9mobile']),
  phone: z.string().regex(/^\+?[0-9]{10,14}$/, 'Invalid phone number'),
  variation_code: z.string().min(1, 'Plan code is required'),
  amount_kobo: z
    .number()
    .int()
    .positive('Amount must be positive')
    .max(100_000_000, 'Amount exceeds maximum'),
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

// ---------------------------------------------------------------------------
// TV
// ---------------------------------------------------------------------------

export const GetTvPlansSchema = z.object({
  provider: z.enum(['dstv', 'gotv', 'startimes', 'showmax']),
});

export const VerifySmartcardSchema = z.object({
  provider: z.enum(['dstv', 'gotv', 'startimes', 'showmax']),
  smartcard: z.string().min(5).max(20, 'Invalid smartcard number'),
});

export const PayTvSchema = z.object({
  provider: z.enum(['dstv', 'gotv', 'startimes', 'showmax']),
  smartcard: z.string().min(5).max(20),
  variation_code: z.string().min(1, 'Subscription plan is required'),
  amount_kobo: z
    .number()
    .int()
    .positive('Amount must be positive')
    .max(500_000_000, 'Amount exceeds maximum'),
  phone: z
    .string()
    .regex(/^\+?[0-9]{10,14}$/)
    .optional(),
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

// ---------------------------------------------------------------------------
// Electricity
// ---------------------------------------------------------------------------

export const GetDiscosSchema = z.object({});

export const VerifyMeterSchema = z.object({
  disco: z.enum([
    'ikeja-electric',
    'eko-electric',
    'kano-electric',
    'phed',
    'jos-electric',
    'ibadan-electric',
    'kaduna-electric',
    'abuja-electric',
    'enugu-electric',
    'benin-electric',
    'aba-electric',
    'yola-electric',
  ]),
  meter_number: z.string().min(5).max(20, 'Invalid meter number'),
  meter_type: z.enum(['prepaid', 'postpaid']),
});

export const PayElectricitySchema = z.object({
  disco: z.enum([
    'ikeja-electric',
    'eko-electric',
    'kano-electric',
    'phed',
    'jos-electric',
    'ibadan-electric',
    'kaduna-electric',
    'abuja-electric',
    'enugu-electric',
    'benin-electric',
    'aba-electric',
    'yola-electric',
  ]),
  meter_number: z.string().min(5).max(20),
  meter_type: z.enum(['prepaid', 'postpaid']),
  amount_kobo: z
    .number()
    .int()
    .min(50000, 'Minimum electricity payment is ₦500')
    .max(500_000_000, 'Amount exceeds maximum'),
  phone: z.string().regex(/^\+?[0-9]{10,14}$/),
  customer_name: z.string().min(2).max(100).optional(),
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------

export const GetEducationProductsSchema = z.object({});

export const PayEducationSchema = z.object({
  product: z.enum(['waec-registration', 'waec', 'jamb']),
  quantity: z.number().int().min(1).max(5).default(1),
  amount_kobo: z.number().int().positive().max(100_000_000, 'Amount exceeds maximum'),
  phone: z.string().regex(/^\+?[0-9]{10,14}$/),
  pin: z.string().regex(/^\d{4}$/, 'Transaction PIN must be 4 digits'),
});

// ---------------------------------------------------------------------------
// History / requery
// ---------------------------------------------------------------------------

export const ListBillsSchema = z.object({
  category: z.enum(['airtime', 'data', 'tv', 'electricity', 'education', 'all']).default('all'),
  status: z
    .enum([
      'pending',
      'processing',
      'delivered',
      'failed',
      'refunded',
      'provider_uncertain',
      'reconciliation_required',
    ])
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuyAirtimeInput = z.infer<typeof BuyAirtimeSchema>;
export type GetDataPlansInput = z.infer<typeof GetDataPlansSchema>;
export type BuyDataInput = z.infer<typeof BuyDataSchema>;
export type GetTvPlansInput = z.infer<typeof GetTvPlansSchema>;
export type VerifySmartcardInput = z.infer<typeof VerifySmartcardSchema>;
export type PayTvInput = z.infer<typeof PayTvSchema>;
export type VerifyMeterInput = z.infer<typeof VerifyMeterSchema>;
export type PayElectricityInput = z.infer<typeof PayElectricitySchema>;
export type PayEducationInput = z.infer<typeof PayEducationSchema>;
export type ListBillsInput = z.infer<typeof ListBillsSchema>;
