import { Router } from 'express';
import type { Request, Response } from 'express';
import { processPayPalWebhook } from '../services/paypal-checkout.js';

export const paypalWebhookRouter = Router();

function header(req: Request, name: string): string {
  const value = req.headers[name];
  return typeof value === 'string' ? value : '';
}

paypalWebhookRouter.post('/webhook', async (req: Request, res: Response) => {
  if (!req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(415).json({ error: { message: 'PayPal webhook payload must be a JSON object.', type: 'invalid_request_error' } });
    return;
  }
  const requiredHeaders = {
    transmissionId: header(req, 'paypal-transmission-id'),
    transmissionTime: header(req, 'paypal-transmission-time'),
    transmissionSignature: header(req, 'paypal-transmission-sig'),
    certUrl: header(req, 'paypal-cert-url'),
    authAlgo: header(req, 'paypal-auth-algo'),
  };
  if (Object.values(requiredHeaders).some((value) => !value)) {
    res.status(400).json({ error: { message: 'Missing PayPal signature headers.', type: 'invalid_request_error' } });
    return;
  }
  try {
    const certUrl = new URL(requiredHeaders.certUrl);
    if (certUrl.protocol !== 'https:' || !['api.paypal.com', 'api.sandbox.paypal.com'].includes(certUrl.hostname)) {
      res.status(400).json({ error: { message: 'Invalid PayPal certificate URL.', type: 'invalid_request_error' } });
      return;
    }
  } catch {
    res.status(400).json({ error: { message: 'Invalid PayPal certificate URL.', type: 'invalid_request_error' } });
    return;
  }
  res.json(await processPayPalWebhook(requiredHeaders, req.body));
});