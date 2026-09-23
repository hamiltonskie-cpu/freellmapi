import { beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';

async function request(app: Express, method: string, path: string): Promise<{ status: number; headers: Headers }> {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: address.port, method, path }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: new Headers(res.headers as Record<string, string>) });
      });
      req.on('error', reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

describe('application network security', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  it('rejects dangerous HTTP methods before route dispatch', async () => {
    const result = await request(app, 'TRACE', '/api/ping');
    expect(result.status).toBe(405);
  });

  it('rejects oversized request URLs', async () => {
    const result = await request(app, 'GET', `/api/ping?value=${'x'.repeat(8192)}`);
    expect(result.status).toBe(414);
  });

  it('adds non-sniffing, privacy, and no-store API headers', async () => {
    const result = await request(app, 'GET', '/api/ping');
    expect(result.status).toBe(200);
    expect(result.headers.get('x-powered-by')).toBeNull();
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
});