import type { Request, Response, NextFunction } from 'express';

const MAX_URL_LENGTH = 8 * 1024;
const MAX_HEADER_BYTES = 32 * 1024;

/** Application-layer firewall for requests that made it to Express. */
export function networkSecurity(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'TRACE' || req.method === 'TRACK' || req.method === 'CONNECT') {
    res.status(405).setHeader('Allow', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS').json({
      error: { message: 'HTTP method not allowed.', type: 'method_not_allowed' },
    });
    return;
  }

  if (req.originalUrl.length > MAX_URL_LENGTH) {
    res.status(414).json({ error: { message: 'Request URL is too long.', type: 'uri_too_long' } });
    return;
  }

  const headerBytes = Object.entries(req.headers).reduce((total, [name, value]) => total + name.length + String(value ?? '').length, 0);
  if (headerBytes > MAX_HEADER_BYTES) {
    res.status(431).json({ error: { message: 'Request headers are too large.', type: 'request_header_fields_too_large' } });
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.path.startsWith('/api/') || req.path.startsWith('/v1/') || req.path.startsWith('/mcp')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

export const NETWORK_SECURITY_LIMITS = { maxUrlLength: MAX_URL_LENGTH, maxHeaderBytes: MAX_HEADER_BYTES } as const;