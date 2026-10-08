import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../db/index.js';
import { createPaymentIntent, getBalance, setComplianceStatus } from '../../services/billing-ledger.js';
import { createUser } from '../../services/auth.js';
import { createWorkspace } from '../../services/workspaces.js';
import { configureCreatorPayPal, listCreatorPayoutAllocations } from '../../services/creator-payouts.js';
import { createPayPalOrder, formatPayPalAmount, processPayPalWebhook, resetPayPalTokenCacheForTests } from '../../services/paypal-checkout.js';

const originalEnv = new Map<string, string | undefined>();
const PAYPAL_ENV_KEYS = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_ENV', 'PAYPAL_RETURN_URL', 'PAYPAL_CANCEL_URL', 'PAYPAL_PAYOUTS_ENABLED'];

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function configurePayPal(): void {
  process.env.PAYPAL_CLIENT_ID = 'client-id';
  process.env.PAYPAL_CLIENT_SECRET = 'client-secret';
  process.env.PAYPAL_WEBHOOK_ID = 'webhook-id';
  process.env.PAYPAL_ENV = 'sandbox';
  process.env.PAYPAL_RETURN_URL = 'https://app.example.test/paypal-return';
  process.env.PAYPAL_CANCEL_URL = 'https://app.example.test/operations?checkout=cancel';
  resetPayPalTokenCacheForTests();
}

describe('PayPal Checkout', () => {
  let userId: number;
  let workspaceId: number;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    for (const key of PAYPAL_ENV_KEYS) originalEnv.set(key, process.env[key]);
    initDb(':memory:');
    userId = createUser('paypal@example.test', 'correct horse battery staple').userId;
    workspaceId = createWorkspace(userId, 'PayPal Hospital', 'hospital', 'ZAR', 'ZA', 'paypal').id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetPayPalTokenCacheForTests();
    for (const key of PAYPAL_ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('formats supported two-decimal currencies using integer minor units', () => {
    expect(formatPayPalAmount(1250, 'ZAR')).toBe('12.50');
    expect(() => formatPayPalAmount(100, 'JPY')).toThrow('supports USD and ZAR');
  });

  it('creates an idempotent PayPal order and stores its approval URL', async () => {
    configurePayPal();
    const intent = createPaymentIntent(userId, { workspaceId, amountMinor: 2500, currency: 'ZAR', idempotencyKey: 'paypal-order-test' });
    setComplianceStatus(userId, workspaceId, intent.id, 'approved');
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse({ access_token: 'access-token', expires_in: 300 }))
      .mockResolvedValueOnce(mockResponse({ id: 'ORDER-123', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123' }] }, 201));
    vi.stubGlobal('fetch', mockFetch);

    const first = await createPayPalOrder(userId, workspaceId, intent.id);
    const retry = await createPayPalOrder(userId, workspaceId, intent.id);
    const orderRequest = JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body)) as { purchase_units: { amount: { value: string } }[] };
    expect(first).toEqual(retry);
    expect(first.orderId).toBe('ORDER-123');
    expect(orderRequest.purchase_units[0]?.amount.value).toBe('25.00');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('settles only a verified completed capture and ignores duplicate webhook deliveries', async () => {
    configurePayPal();
    const testWorkspaceId = createWorkspace(userId, 'Webhook Hospital', 'hospital', 'ZAR', 'ZA', 'paypal').id;
    const intent = createPaymentIntent(userId, { workspaceId: testWorkspaceId, amountMinor: 4200, currency: 'ZAR', idempotencyKey: 'paypal-webhook-test' });
    setComplianceStatus(userId, testWorkspaceId, intent.id, 'approved');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(mockResponse({ access_token: 'access-token', expires_in: 300 }))
      .mockResolvedValueOnce(mockResponse({ id: 'ORDER-456', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-456' }] }, 201)));
    await createPayPalOrder(userId, testWorkspaceId, intent.id);

    const verificationFetch = vi.fn().mockImplementation(() => mockResponse({ verification_status: 'SUCCESS' }));
    vi.stubGlobal('fetch', verificationFetch);
    const headers = { transmissionId: 'transmission-1', transmissionTime: '2026-10-08T12:00:00Z', transmissionSignature: 'signature', certUrl: 'https://api.paypal.com/cert', authAlgo: 'SHA256withRSA' };
    const event = { id: 'EVENT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE-1', status: 'COMPLETED', amount: { currency_code: 'ZAR', value: '42.00' }, supplementary_data: { related_ids: { order_id: 'ORDER-456' } } } };

    expect((await processPayPalWebhook(headers, event)).processed).toBe(true);
    expect((await processPayPalWebhook(headers, event)).reason).toBe('duplicate');
    expect(getBalance(userId, testWorkspaceId).balanceMinor).toBe(4200);
    expect(verificationFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid signatures and capture amount mismatches without ledger credit', async () => {
    configurePayPal();
    const testWorkspaceId = createWorkspace(userId, 'Mismatch Hospital', 'hospital', 'ZAR', 'ZA', 'paypal').id;
    const intent = createPaymentIntent(userId, { workspaceId: testWorkspaceId, amountMinor: 5000, currency: 'ZAR', idempotencyKey: 'paypal-mismatch-test' });
    setComplianceStatus(userId, testWorkspaceId, intent.id, 'approved');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(mockResponse({ access_token: 'access-token', expires_in: 300 }))
      .mockResolvedValueOnce(mockResponse({ id: 'ORDER-789', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-789' }] }, 201)));
    await createPayPalOrder(userId, testWorkspaceId, intent.id);
    const headers = { transmissionId: 'transmission-2', transmissionTime: '2026-10-08T12:00:00Z', transmissionSignature: 'bad-signature', certUrl: 'https://api.paypal.com/cert', authAlgo: 'SHA256withRSA' };
    const event = { id: 'EVENT-2', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE-2', status: 'COMPLETED', amount: { currency_code: 'ZAR', value: '51.00' }, supplementary_data: { related_ids: { order_id: 'ORDER-789' } } } };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ verification_status: 'FAILURE' })));
    await expect(processPayPalWebhook(headers, event)).rejects.toThrow('could not be verified');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ verification_status: 'SUCCESS' })));
    await expect(processPayPalWebhook(headers, event)).rejects.toThrow('does not match');
    expect(getBalance(userId, testWorkspaceId).balanceMinor).toBe(0);
  });

  it('submits creator-first PayPal payouts only when enabled and marks them paid from a verified event', async () => {
    configurePayPal();
    process.env.PAYPAL_PAYOUTS_ENABLED = '1';
    configureCreatorPayPal(userId, 'ZA', 'creator@example.test', 7000);
    const testWorkspaceId = createWorkspace(userId, 'Creator Share Clinic', 'hospital', 'ZAR', 'ZA', 'paypal').id;
    const intent = createPaymentIntent(userId, { workspaceId: testWorkspaceId, amountMinor: 10000, currency: 'ZAR', idempotencyKey: 'paypal-creator-payout-test' });
    setComplianceStatus(userId, testWorkspaceId, intent.id, 'approved');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(mockResponse({ access_token: 'access-token', expires_in: 300 }))
      .mockResolvedValueOnce(mockResponse({ id: 'ORDER-PAYOUT', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-PAYOUT' }] }, 201)));
    await createPayPalOrder(userId, testWorkspaceId, intent.id);

    const paypalFetch = vi.fn()
      .mockImplementationOnce(() => mockResponse({ verification_status: 'SUCCESS' }))
      .mockImplementationOnce(() => mockResponse({ batch_header: { payout_batch_id: 'PAYOUT-BATCH-1', batch_status: 'PENDING' } }, 201));
    vi.stubGlobal('fetch', paypalFetch);
    const captureEvent = { id: 'CAPTURE-EVENT-PAYOUT', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE-PAYOUT', status: 'COMPLETED', amount: { currency_code: 'ZAR', value: '100.00' }, supplementary_data: { related_ids: { order_id: 'ORDER-PAYOUT' } } } };
    const headers = { transmissionId: 'payout-transmission', transmissionTime: '2026-10-08T12:00:00Z', transmissionSignature: 'signature', certUrl: 'https://api.paypal.com/cert', authAlgo: 'SHA256withRSA' };
    await processPayPalWebhook(headers, captureEvent);
    expect(listCreatorPayoutAllocations(userId)[0]).toMatchObject({ amountMinor: 7000, status: 'submitted', providerReference: 'PAYOUT-BATCH-1' });

    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => mockResponse({ verification_status: 'SUCCESS' })));
    const payoutEvent = { id: 'PAYOUT-EVENT-PAID', event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS', resource: { batch_header: { payout_batch_id: 'PAYOUT-BATCH-1' } } };
    expect((await processPayPalWebhook(headers, payoutEvent)).reason).toBe('payout_paid');
    expect(listCreatorPayoutAllocations(userId)[0]?.status).toBe('paid');
  });
});