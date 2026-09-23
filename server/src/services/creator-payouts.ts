import { decrypt, encrypt } from '../lib/crypto.js';
import { getDb } from '../db/index.js';

export type CreatorPayoutAccount = { id: number; provider: 'paypal'; countryCode: string; maskedAccount: string; priority: number; shareBps: number; enabled: boolean };

function maskAccount(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return 'hidden';
  return `${value.slice(0, 2)}***${value.slice(at)}`;
}

export function configureCreatorPayPal(userId: number, countryCode: string, accountEmail: string, shareBps = 7000): CreatorPayoutAccount {
  const country = countryCode.trim().toUpperCase();
  const email = accountEmail.trim().toLowerCase();
  if (!/^[A-Z]{2}$/.test(country)) throw Object.assign(new Error('Country must be an ISO 3166-1 alpha-2 code.'), { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Enter a valid PayPal account email.'), { status: 400 });
  if (!Number.isInteger(shareBps) || shareBps < 1 || shareBps > 10000) throw Object.assign(new Error('Creator share must be between 1% and 100%.'), { status: 400 });
  const db = getDb();
  const encrypted = encrypt(email);
  const result = db.prepare(`INSERT INTO creator_payout_accounts (owner_user_id, provider, country_code, encrypted_account_ref, iv, auth_tag, priority, share_bps) SELECT ?, 'paypal', ?, ?, ?, ?, COALESCE(MAX(priority), 0) + 1, ? FROM creator_payout_accounts WHERE owner_user_id = ?`)
    .run(userId, country, encrypted.encrypted, encrypted.iv, encrypted.authTag, shareBps, userId);
  return { id: Number(result.lastInsertRowid), provider: 'paypal', countryCode: country, maskedAccount: maskAccount(email), priority: Number(result.lastInsertRowid), shareBps, enabled: true };
}

export function listCreatorPayoutAccounts(userId: number): CreatorPayoutAccount[] {
  const rows = getDb().prepare('SELECT id, provider, country_code, encrypted_account_ref, iv, auth_tag, priority, share_bps, enabled FROM creator_payout_accounts WHERE owner_user_id = ? ORDER BY priority, id').all(userId) as { id: number; provider: 'paypal'; country_code: string; encrypted_account_ref: string; iv: string; auth_tag: string; priority: number; share_bps: number; enabled: number }[];
  return rows.map((row) => ({ id: row.id, provider: row.provider, countryCode: row.country_code, maskedAccount: maskAccount(decrypt(row.encrypted_account_ref, row.iv, row.auth_tag)), priority: row.priority, shareBps: row.share_bps, enabled: row.enabled === 1 }));
}

export function allocateCreatorShare(workspaceId: number, paymentIntentId: number, amountMinor: number, currency: string): void {
  const db = getDb();
  const row = db.prepare(`SELECT a.id, a.share_bps FROM workspaces w JOIN creator_payout_accounts a ON a.owner_user_id = w.owner_user_id WHERE w.id = ? AND a.enabled = 1 ORDER BY a.priority, a.id LIMIT 1`).get(workspaceId) as { id: number; share_bps: number } | undefined;
  if (!row) return;
  const creatorAmount = Math.floor((amountMinor * row.share_bps) / 10_000);
  if (creatorAmount < 1) return;
  db.prepare(`INSERT OR IGNORE INTO creator_payout_allocations (payment_intent_id, payout_account_id, workspace_id, amount_minor, currency) VALUES (?, ?, ?, ?, ?)`)
    .run(paymentIntentId, row.id, workspaceId, creatorAmount, currency);
}