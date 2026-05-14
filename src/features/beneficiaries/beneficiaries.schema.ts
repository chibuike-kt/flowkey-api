import { z } from 'zod';

// ---------------------------------------------------------------------------
// Add internal beneficiary (FlowKey user)
// ---------------------------------------------------------------------------

export const AddInternalBeneficiarySchema = z.object({
  type: z.literal('internal'),
  recipient_wallet_id: z.string().uuid('recipient_wallet_id must be a UUID'),
  nickname: z.string().min(1).max(50).optional(),
});

// ---------------------------------------------------------------------------
// Add bank beneficiary
// ---------------------------------------------------------------------------

export const AddBankBeneficiarySchema = z.object({
  type: z.literal('bank'),
  bank_code: z.string().min(3).max(10, 'Invalid bank code'),
  bank_name: z.string().min(2).max(100),
  account_number: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  account_name: z.string().min(2).max(100),
  nickname: z.string().min(1).max(50).optional(),
});

// ---------------------------------------------------------------------------
// Combined add schema (discriminated union)
// ---------------------------------------------------------------------------

export const AddBeneficiarySchema = z.discriminatedUnion('type', [
  AddInternalBeneficiarySchema,
  AddBankBeneficiarySchema,
]);

// ---------------------------------------------------------------------------
// Update beneficiary (nickname only — account details are immutable)
// ---------------------------------------------------------------------------

export const UpdateBeneficiarySchema = z.object({
  nickname: z.string().min(1).max(50).nullable(),
});

// ---------------------------------------------------------------------------
// List beneficiaries
// ---------------------------------------------------------------------------

export const ListBeneficiariesSchema = z.object({
  type: z.enum(['internal', 'bank', 'all']).default('all'),
  search: z.string().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AddBeneficiaryInput = z.infer<typeof AddBeneficiarySchema>;
export type UpdateBeneficiaryInput = z.infer<typeof UpdateBeneficiarySchema>;
export type ListBeneficiariesInput = z.infer<typeof ListBeneficiariesSchema>;
