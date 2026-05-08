import { z } from 'zod';

export const GenerateQrSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('static'),
    narration: z.string().max(255).optional(),
  }),
  z.object({
    type: z.literal('dynamic'),
    amount_kobo: z
      .number()
      .int('Amount must be an integer')
      .positive('Amount must be positive')
      .max(500_000_000_00, 'Amount exceeds single-transfer maximum'),
    narration: z.string().max(255).optional(),
    expires_in_minutes: z
      .number()
      .int()
      .min(1)
      .max(10_080) // max 7 days
      .default(30),
  }),
]);

export const DecodeQrSchema = z.object({
  payload: z.string().min(1, 'QR payload is required'),
});

export const DeactivateQrSchema = z.object({
  // empty — QR id comes from route param
});

export type GenerateQrInput = z.infer<typeof GenerateQrSchema>;
export type DecodeQrInput = z.infer<typeof DecodeQrSchema>;
