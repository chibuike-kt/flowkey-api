import { Router } from 'express';
import type { Request, Response } from 'express';
import { handleProvidusWebhook, handlePaystackWebhook } from './webhooks.service';

const router = Router();

// Raw body is attached by express.raw() in app.ts for this router
function getRawBody(req: Request): string {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  return raw ? raw.toString('utf8') : JSON.stringify(req.body);
}

// POST /webhooks/v1/providus
router.post('/providus', async (req: Request, res: Response) => {
  const signature = (req.headers['x-prv-signature'] as string) ?? '';
  await handleProvidusWebhook(getRawBody(req), signature);
  res.status(200).json({ received: true });
});

// POST /webhooks/v1/paystack
router.post('/paystack', async (req: Request, res: Response) => {
  const signature = (req.headers['x-paystack-signature'] as string) ?? '';
  await handlePaystackWebhook(getRawBody(req), signature);
  res.status(200).json({ received: true });
});

export { router as webhooksRouter };
