import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';
import { allocateCreatorShare } from './creator-payouts.js';
import { requireWorkspaceMember } from './workspaces.js';

type PayPalConfig = { clientId: string; clientSecret: string; webhookId: string; baseUrl: string; returnUrl: string; cancelUrl: string };
type PayPalLink = { href: string; rel: string };
type PayPalIntentRow = { id: number; workspace_id: number; amount_minor: number; currency: string; description: string; status: string; compliance_status: string; provider_reference: string | null; paypal_approval_url: string | null };

let cachedToken: { value: string; expiresAt: number; baseUrl: string } | null = null;

function config(requireWebhook = false): PayPalConfig {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() ?? '';
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim() ?? '';
  const environment = (process.env.PAYPAL_ENV ?? 'sandbox').trim().toLowerCase();
  const returnUrl = process.env.PAYPAL_RETURN_URL?.trim() ?? '';
  const cancelUrl = process.env.PAYPAL_CANCEL_URL?.trim() ?? '';
  if (!clientId || !clientSecret || (requireWebhook && !webhookId)) {
    throw Object.assign(new Error('PayPal is not configured. Set the PayPal REST credentials and webhook ID.'), { status: 503 });
  }
  if (environment !== 'sandbox' && environment !== 'live') {
    throw Object.assign(new Error('PAYPAL_ENV must be sandbox or live.'), { status: 500 });
  }
  if (!returnUrl || !cancelUrl || !isHttpsUrl(returnUrl) || !isHttpsUrl(cancelUrl)) {
    throw Object.assign(new Error('Set HTTPS PAYPAL_RETURN_URL and PAYPAL_CANCEL_URL before enabling checkout.'), { status: 503 });
  }
  return {
    clientId,
    clientSecret,
    webhookId,
    baseUrl: environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    returnUrl,
    cancelUrl,
  };
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function formatPayPalAmount(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw Object.assign(new Error('Payment amount must be a positive safe integer.'), { status: 400 });
  if (!['USD', 'ZAR'].includes(currency.toUpperCase())) throw Object.assign(new Error(`PayPal Checkout currently supports USD and ZAR only; received ${currency}.`), { status: 400 });
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, '0')}`;
}

async function accessToken(paypal: PayPalConfig): Promise<string> {
  if (cachedToken && cachedToken.baseUrl === paypal.baseUrl && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const response = await fetch(`${paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${paypal.clientId}:${paypal.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Object.assign(new Error('PayPal authentication failed. Check the server credentials and environment.'), { status: 502 });
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw Object.assign(new Error('PayPal did not return an access token.'), { status: 502 });
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 300) * 1000, baseUrl: paypal.baseUrl };
  return payload.access_token;
}

function getIntent(workspaceId: number, intentId: number): PayPalIntentRow {
  const row = getDb().prepare('SELECT id, workspace_id, amount_minor, currency, description, status, compliance_status, provider_reference, paypal_approval_url FROM payment_intents WHERE workspace_id = ? AND id = ?').get(workspaceId, intentId) as PayPalIntentRow | undefined;
  if (!row) throw Object.assign(new Error('Payment intent not found.'), { status: 404 });
  return row;
}

export async function createPayPalOrder(userId: number, workspaceId: number, intentId: number) {
  const workspace = requireWorkspaceMember(userId, workspaceId);
  if (workspace.paymentProvider !== 'internal' && workspace.paymentProvider !== 'paypal') {
    throw Object.assign(new Error(`${workspace.paymentProvider} is configured for this workspace; PayPal checkout is not enabled for it.`), { status: 409 });
  }
  const paypal = config();
  const intent = getIntent(workspaceId, intentId);
  if (intent.compliance_status !== 'approved') throw Object.assign(new Error('Payment must be approved before checkout.'), { status: 403 });
  if (intent.status !== 'pending') throw Object.assign(new Error('Only pending payment intents can start PayPal checkout.'), { status: 409 });
  if (intent.provider_reference && intent.paypal_approval_url) {
    return { orderId: intent.provider_reference, approvalUrl: intent.paypal_approval_url };
  }

  const token = await accessToken(paypal);
  const requestId = `dea-${workspaceId}-${intentId}`;
  const response = await fetch(`${paypal.baseUrl}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `workspace-${workspaceId}-payment-${intentId}`,
        custom_id: String(intentId),
        invoice_id: requestId,
        description: intent.description.slice(0, 127) || 'Workspace credits',
        amount: { currency_code: intent.currency, value: formatPayPalAmount(intent.amount_minor, intent.currency) },
      }],
      payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', return_url: checkoutReturnUrl(paypal.returnUrl, workspaceId, intentId), cancel_url: paypal.cancelUrl } } },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Object.assign(new Error('PayPal could not create the checkout order. Please retry or contact support.'), { status: 502 });
  const order = await response.json() as { id?: string; links?: PayPalLink[] };
  const approvalUrl = order.links?.find((link) => link.rel === 'payer-action')?.href
    ?? order.links?.find((link) => link.rel === 'approve')?.href;
  if (!order.id || !approvalUrl || !isHttpsUrl(approvalUrl)) throw Object.assign(new Error('PayPal returned an invalid approval link.'), { status: 502 });

  const update = getDb().prepare(`UPDATE payment_intents SET provider_reference = ?, paypal_approval_url = ? WHERE id = ? AND workspace_id = ? AND status = 'pending' AND compliance_status = 'approved' AND provider_reference IS NULL`)
    .run(order.id, approvalUrl, intentId, workspaceId);
  if (update.changes === 0) {
    const latest = getIntent(workspaceId, intentId);
    if (latest.provider_reference === order.id && latest.paypal_approval_url) return { orderId: order.id, approvalUrl: latest.paypal_approval_url };
    throw Object.assign(new Error('Payment intent changed while checkout was starting. Refresh and retry.'), { status: 409 });
  }
  return { orderId: order.id, approvalUrl };
}

export async function capturePayPalOrder(userId: number, workspaceId: number, intentId: number) {
  const workspace = requireWorkspaceMember(userId, workspaceId);
  if (workspace.paymentProvider !== 'internal' && workspace.paymentProvider !== 'paypal') {
    throw Object.assign(new Error(`${workspace.paymentProvider} is configured for this workspace; PayPal capture is not enabled.`), { status: 409 });
  }
  const paypal = config();
  const intent = getIntent(workspaceId, intentId);
  if (intent.compliance_status !== 'approved') throw Object.assign(new Error('Payment must be approved before capture.'), { status: 403 });
  if (!intent.provider_reference) throw Object.assign(new Error('No PayPal order exists for this payment.'), { status: 409 });
  if (intent.status === 'settled') return { orderId: intent.provider_reference, status: 'COMPLETED', ledgerStatus: 'settled' };

  const token = await accessToken(paypal);
  const response = await fetch(`${paypal.baseUrl}/v2/checkout/orders/${encodeURIComponent(intent.provider_reference)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `dea-capture-${workspaceId}-${intentId}`,
      Prefer: 'return=representation',
    },
    body: '{}',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Object.assign(new Error('PayPal could not capture this order. Check its approval status and retry.'), { status: 502 });
  const result = await response.json() as { id?: string; status?: string };
  return { orderId: intent.provider_reference, captureId: result.id ?? null, status: result.status ?? 'UNKNOWN', ledgerStatus: 'awaiting_verified_webhook' };
}

export async function submitCreatorPayPalPayout(userId: number, allocationId: number) {
  if (process.env.PAYPAL_PAYOUTS_ENABLED?.trim() !== '1') {
    throw Object.assign(new Error('Creator transfers are disabled. Set PAYPAL_PAYOUTS_ENABLED=1 after PayPal enables Payouts for your business account.'), { status: 503 });
  }
  const paypal = config(true);
  const row = getDb().prepare(`
    SELECT p.id, p.payment_intent_id, p.amount_minor, p.currency, p.status, p.provider_reference,
      a.owner_user_id, a.encrypted_account_ref, a.iv, a.auth_tag
    FROM creator_payout_allocations p
    JOIN creator_payout_accounts a ON a.id = p.payout_account_id
    WHERE p.id = ? AND a.owner_user_id = ? AND a.enabled = 1
  `).get(allocationId, userId) as { id: number; payment_intent_id: number; amount_minor: number; currency: string; status: string; provider_reference: string | null; owner_user_id: number; encrypted_account_ref: string; iv: string; auth_tag: string } | undefined;
  if (!row) throw Object.assign(new Error('Creator allocation not found.'), { status: 404 });
  if (row.status === 'submitted' || row.status === 'paid') return { allocationId, status: row.status };
  if (row.status !== 'pending' && row.status !== 'failed') throw Object.assign(new Error('Creator allocation cannot be submitted in its current state.'), { status: 409 });

  const batchId = row.status === 'pending' && row.provider_reference
    ? row.provider_reference
    : `DEA-${crypto.randomBytes(11).toString('hex')}`;
  const senderItemId = `${batchId}-I`;
  getDb().prepare("UPDATE creator_payout_allocations SET status = 'pending', provider_reference = ? WHERE id = ?").run(batchId, allocationId);
  const token = await accessToken(paypal);
  const response = await fetch(`${paypal.baseUrl}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': batchId,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      sender_batch_header: { sender_batch_id: batchId, email_subject: 'Your Dea Foundations creator share' },
      items: [{
        recipient_type: 'EMAIL',
        amount: { value: formatPayPalAmount(row.amount_minor, row.currency), currency: row.currency },
        receiver: decrypt(row.encrypted_account_ref, row.iv, row.auth_tag),
        note: 'Creator-first share from a settled Dea Foundations payment.',
        sender_item_id: senderItemId,
      }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    getDb().prepare("UPDATE creator_payout_allocations SET status = 'failed' WHERE id = ?").run(allocationId);
    throw Object.assign(new Error('PayPal could not submit this creator transfer. The allocated funds remain recorded for retry.'), { status: 502 });
  }
  const result = await response.json() as { batch_header?: { payout_batch_id?: string; batch_status?: string } };
  const payoutBatchId = result.batch_header?.payout_batch_id;
  if (!payoutBatchId) throw Object.assign(new Error('PayPal did not return a payout batch ID.'), { status: 502 });
  getDb().prepare("UPDATE creator_payout_allocations SET status = 'submitted', provider_reference = ? WHERE id = ?").run(payoutBatchId, allocationId);
  return { allocationId, status: 'submitted', providerReference: payoutBatchId, providerStatus: result.batch_header?.batch_status ?? 'PENDING' };
}

type PayPalWebhookHeaders = {
  transmissionId: string;
  transmissionTime: string;
  transmissionSignature: string;
  certUrl: string;
  authAlgo: string;
};

export async function processPayPalWebhook(headers: PayPalWebhookHeaders, event: unknown) {
  const paypal = config(true);
  const token = await accessToken(paypal);
  const verification = await fetch(`${paypal.baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSignature,
      transmission_time: headers.transmissionTime,
      webhook_id: paypal.webhookId,
      webhook_event: event,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!verification.ok) throw Object.assign(new Error('PayPal webhook verification service is unavailable.'), { status: 502 });
  const verificationResult = await verification.json() as { verification_status?: string };
  if (verificationResult.verification_status !== 'SUCCESS') throw Object.assign(new Error('PayPal webhook signature could not be verified.'), { status: 401 });

  const payload = event as {
    id?: string;
    event_type?: string;
    resource?: {
      id?: string;
      status?: string;
      amount?: { currency_code?: string; value?: string };
      supplementary_data?: { related_ids?: { order_id?: string } };
        batch_header?: { payout_batch_id?: string };
    };
  };
  if (!payload.id || !payload.event_type) throw Object.assign(new Error('Invalid PayPal webhook payload.'), { status: 400 });
  const db = getDb();
  if (db.prepare('SELECT event_id FROM paypal_webhook_events WHERE event_id = ?').get(payload.id)) {
    return { received: true, processed: false, reason: 'duplicate' };
  }

  if (payload.event_type === 'PAYMENT.PAYOUTSBATCH.SUCCESS' || payload.event_type === 'PAYMENT.PAYOUTSBATCH.DENIED') {
    const resource = payload.resource as { batch_header?: { payout_batch_id?: string } } | undefined;
    const batchId = resource?.batch_header?.payout_batch_id;
    if (!batchId) throw Object.assign(new Error('PayPal payout event is missing its batch ID.'), { status: 400 });
    const paid = payload.event_type === 'PAYMENT.PAYOUTSBATCH.SUCCESS';
    const updateBatch = db.transaction(() => {
      const inserted = db.prepare('INSERT OR IGNORE INTO paypal_webhook_events (event_id, event_type) VALUES (?, ?)').run(payload.id, payload.event_type!);
      if (!inserted.changes) return false;
      db.prepare('UPDATE creator_payout_allocations SET status = ? WHERE provider_reference = ? AND status = \'submitted\'').run(paid ? 'paid' : 'failed', batchId);
      return true;
    });
    return { received: true, processed: updateBatch(), reason: paid ? 'payout_paid' : 'payout_failed' };
  }

  if (payload.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return { received: true, processed: false, reason: 'event_ignored' };

  const resource = payload.resource;
  const orderId = resource?.supplementary_data?.related_ids?.order_id;
  if (resource?.status !== 'COMPLETED' || !resource.id || !orderId || !resource.amount?.currency_code || !resource.amount.value) {
    throw Object.assign(new Error('PayPal capture event is missing required payment details.'), { status: 400 });
  }
  const intent = db.prepare(`SELECT i.id, i.workspace_id, i.amount_minor, i.currency, i.compliance_status, i.provider_reference, w.owner_user_id FROM payment_intents i JOIN workspaces w ON w.id = i.workspace_id WHERE i.provider_reference = ?`).get(orderId) as { id: number; workspace_id: number; amount_minor: number; currency: string; compliance_status: string; provider_reference: string; owner_user_id: number } | undefined;
  if (!intent) throw Object.assign(new Error('PayPal order does not match a local payment intent.'), { status: 404 });
  const capturedMinor = parsePayPalAmountMinor(resource.amount.value);
  if (capturedMinor !== intent.amount_minor || resource.amount.currency_code !== intent.currency) {
    throw Object.assign(new Error('PayPal capture amount does not match the payment intent.'), { status: 409 });
  }
  if (intent.compliance_status !== 'approved') throw Object.assign(new Error('Payment has not passed compliance review.'), { status: 403 });

  const settle = db.transaction(() => {
    const inserted = db.prepare('INSERT OR IGNORE INTO paypal_webhook_events (event_id, event_type, capture_id, payment_intent_id) VALUES (?, ?, ?, ?)')
      .run(payload.id, payload.event_type!, resource.id!, intent.id);
    if (inserted.changes === 0) return false;
    db.prepare("UPDATE payment_intents SET status = 'settled', settled_at = datetime('now') WHERE id = ? AND status = 'pending'").run(intent.id);
    db.prepare("INSERT OR IGNORE INTO ledger_entries (workspace_id, payment_intent_id, entry_type, amount_minor, currency, reference) VALUES (?, ?, 'credit', ?, ?, ?)")
      .run(intent.workspace_id, intent.id, intent.amount_minor, intent.currency, `payment:${intent.id}`);
    allocateCreatorShare(intent.workspace_id, intent.id, intent.amount_minor, intent.currency);
    return true;
  });
  const processed = settle();
  if (processed && process.env.PAYPAL_PAYOUTS_ENABLED?.trim() === '1') {
    const allocation = db.prepare('SELECT id FROM creator_payout_allocations WHERE payment_intent_id = ? AND status = \'pending\'').get(intent.id) as { id: number } | undefined;
    if (allocation) {
      try { await submitCreatorPayPalPayout(intent.owner_user_id, allocation.id); }
      catch (error) { console.error(`[paypal] creator payout ${allocation.id} remains queued: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return { received: true, processed, paymentIntentId: intent.id };
}

function parsePayPalAmountMinor(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Object.assign(new Error('Invalid PayPal capture amount.'), { status: 400 });
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw Object.assign(new Error('PayPal capture amount exceeds supported limits.'), { status: 400 });
  return result;
}

function checkoutReturnUrl(configuredReturnUrl: string, workspaceId: number, intentId: number): string {
  const url = new URL(configuredReturnUrl);
  url.searchParams.set('workspaceId', String(workspaceId));
  url.searchParams.set('intentId', String(intentId));
  return url.toString();
}

export function resetPayPalTokenCacheForTests(): void { cachedToken = null; }

export function paypalStatus() {
  return {
    configured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_WEBHOOK_ID && process.env.PAYPAL_RETURN_URL && process.env.PAYPAL_CANCEL_URL),
    payoutsEnabled: process.env.PAYPAL_PAYOUTS_ENABLED?.trim() === '1',
    environment: (process.env.PAYPAL_ENV ?? 'sandbox').trim().toLowerCase() === 'live' ? 'live' : 'sandbox',
  };
}

export function webhookEventFingerprint(eventId: string): string { return crypto.createHash('sha256').update(eventId).digest('hex'); }