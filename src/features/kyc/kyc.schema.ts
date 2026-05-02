import { z } from 'zod';

const bvnSchema = z.string().regex(/^\d{11}$/, 'BVN must be exactly 11 digits');
const ninSchema = z.string().regex(/^\d{11}$/, 'NIN must be exactly 11 digits');

export const UpgradeKycSchema = z.discriminatedUnion('target_tier', [
  z.object({
    target_tier: z.literal(2),
    bvn: bvnSchema,
    nin: ninSchema,
  }),
  z.object({
    target_tier: z.literal(3),
    address_line: z.string().min(5, 'Address is required').max(500),
    utility_bill_reference: z.string().min(1, 'Utility bill reference is required').max(255),
  }),
]);

export type UpgradeKycInput = z.infer<typeof UpgradeKycSchema>;
