import { beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';

async function postWebhook(app: Express, contentType: string, certUrl?: string): Promise<number> {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port: address.port,
        method: 'POST',
        path: '/api/paypal/webhook',
        headers: {
          'content-type': contentType,
          'paypal-transmission-id': 'test-transmission',
          'paypal-transmission-time': '2026-10-08T12:00:00Z',
          'paypal-transmission-sig': 'test-signature',
          'paypal-cert-url': certUrl ?? 'https://attacker.example/cert',
          'paypal-auth-algo': 'SHA256withRSA',
        },
      }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on('error', reject);
      request.end(JSON.stringify({ id: 'event-test', event_type: 'PAYMENT.CAPTURE.COMPLETED' }));
    });
  } finally {
    server.close();
  }
}

describe('PayPal webhook edge protections', () => {
  let app: Express;
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  it('rejects non-JSON webhook payloads before signature verification', async () => {
    expect(await postWebhook(app, 'text/plain')).toBe(415);
  });

  it('rejects certificate URLs outside PayPal before making outbound calls', async () => {
    expect(await postWebhook(app, 'application/json', 'https://attacker.example/cert')).toBe(400);
  });
});
