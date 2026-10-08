import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createPaymentIntent, getBalance, setComplianceStatus, settlePayment } from '../services/billing-ledger.js';
import { capturePayPalOrder, createPayPalOrder, paypalStatus } from '../services/paypal-checkout.js';

export const billingLedgerRouter = Router();
const intentSchema = z.object({
  workspaceId: z.number().int().positive(),
  amountMinor: z.number().int().positive(),
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/),
  description: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1).max(160),
}).strict();
const complianceSchema = z.object({ status: z.enum(['approved', 'rejected']) }).strict();

function userId(req: Request): number {
  return (req as Request & { user: { userId: number } }).user.userId;
}

billingLedgerRouter.get('/:workspaceId/balance', (req: Request, res: Response) => {
  res.json(getBalance(userId(req), Number(req.params.workspaceId)));
});

billingLedgerRouter.post('/intents', (req: Request, res: Response) => {
  const parsed = intentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(error => error.message).join(', '), type: 'invalid_request_error' } });
    return;
  }
  res.status(201).json({ intent: createPaymentIntent(userId(req), parsed.data) });
});

billingLedgerRouter.post('/intents/:workspaceId/:intentId/compliance', (req: Request, res: Response) => {
  const parsed = complianceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'status must be approved or rejected.', type: 'invalid_request_error' } });
    return;
  }
  res.json({ intent: setComplianceStatus(userId(req), Number(req.params.workspaceId), Number(req.params.intentId), parsed.data.status) });
});

billingLedgerRouter.post('/intents/:workspaceId/:intentId/settle', (req: Request, res: Response) => {
  res.json({ intent: settlePayment(userId(req), Number(req.params.workspaceId), Number(req.params.intentId)) });
});

billingLedgerRouter.get('/paypal/status', (_req: Request, res: Response) => res.json(paypalStatus()));

billingLedgerRouter.post('/intents/:workspaceId/:intentId/paypal-order', async (req: Request, res: Response) => {
  const order = await createPayPalOrder(userId(req), Number(req.params.workspaceId), Number(req.params.intentId));
  res.status(201).json(order);
});

billingLedgerRouter.post('/intents/:workspaceId/:intentId/paypal-capture', async (req: Request, res: Response) => {
  const result = await capturePayPalOrder(userId(req), Number(req.params.workspaceId), Number(req.params.intentId));
  res.json(result);
});