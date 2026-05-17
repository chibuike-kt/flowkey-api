import { z } from 'zod';

export const DecodeQrSchema = z.object({
  payload: z.string().min(1, 'QR payload is required'),
});

export type DecodeQrInput = z.infer<typeof DecodeQrSchema>;
