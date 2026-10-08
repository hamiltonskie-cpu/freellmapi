import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { configureCreatorPayPal, listCreatorPayoutAccounts, listCreatorPayoutAllocations } from '../services/creator-payouts.js';
import { submitCreatorPayPalPayout } from '../services/paypal-checkout.js';

export const creatorPayoutsRouter = Router();
const paypalSchema = z.object({
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  accountEmail: z.string().trim().email().max(254),
  shareBps: z.number().int().min(1).max(10000).optional(),
}).strict();

function userId(req: Request): number {
  return (req as Request & { user: { userId: number } }).user.userId;
}

creatorPayoutsRouter.get('/', (req: Request, res: Response) => {
  res.json({ accounts: listCreatorPayoutAccounts(userId(req)), allocations: listCreatorPayoutAllocations(userId(req)) });
});

creatorPayoutsRouter.post('/allocations/:allocationId/submit', async (req: Request, res: Response) => {
  res.json(await submitCreatorPayPalPayout(userId(req), Number(req.params.allocationId)));
});

creatorPayoutsRouter.post('/paypal', (req: Request, res: Response) => {
  const parsed = paypalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'Enter a valid PayPal account and country code.', type: 'invalid_request_error' } });
    return;
  }
  const account = configureCreatorPayPal(userId(req), parsed.data.countryCode, parsed.data.accountEmail, parsed.data.shareBps);
  res.status(201).json({ account, transferStatus: 'pending_adapter_configuration' });
});