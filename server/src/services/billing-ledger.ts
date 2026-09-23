import { getDb } from '../db/index.js';
import { requireWorkspaceMember } from './workspaces.js';
import { allocateCreatorShare } from './creator-payouts.js';

export type PaymentIntent = {
  id: number;
  workspaceId: number;
  amountMinor: number;
  currency: string;
  description: string;
  status: string;
  complianceStatus: string;
  createdAt: string;
  settledAt: string | null;
  providerReference: string | null;
};

type IntentRow = { id: number; workspace_id: number; amount_minor: number; currency: string; description: string; status: string; compliance_status: string; created_at: string; settled_at: string | null; provider_reference: string | null };

function toIntent(row: IntentRow): PaymentIntent {
  return { id: row.id, workspaceId: row.workspace_id, amountMinor: row.amount_minor, currency: row.currency, description: row.description, status: row.status, complianceStatus: row.compliance_status, createdAt: row.created_at, settledAt: row.settled_at, providerReference: row.provider_reference };
}

function getIntent(workspaceId: number, id: number): PaymentIntent {
  const row = getDb().prepare('SELECT * FROM payment_intents WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as IntentRow | undefined;
  if (!row) throw Object.assign(new Error('Payment intent not found.'), { status: 404 });
  return toIntent(row);
}

export function createPaymentIntent(userId: number, input: { workspaceId: number; amountMinor: number; currency: string; description?: string; idempotencyKey: string }): PaymentIntent {
  const workspace = requireWorkspaceMember(userId, input.workspaceId);
  if (workspace.paymentProvider !== 'internal') {
    throw Object.assign(new Error(`${workspace.paymentProvider} is configured for this workspace, but its merchant adapter is not configured yet.`), { status: 501 });
  }
  const currency = input.currency.trim().toUpperCase();
  const key = input.idempotencyKey.trim();
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) throw Object.assign(new Error('amountMinor must be a positive integer.'), { status: 400 });
  if (currency !== workspace.currency) throw Object.assign(new Error(`This workspace accepts ${workspace.currency}.`), { status: 400 });
  if (!key || key.length > 160) throw Object.assign(new Error('A unique idempotency key is required.'), { status: 400 });

  const db = getDb();
  const existing = db.prepare('SELECT * FROM payment_intents WHERE workspace_id = ? AND idempotency_key = ?').get(workspace.id, key) as IntentRow | undefined;
  if (existing) return toIntent(existing);
  const result = db.prepare(`INSERT INTO payment_intents (workspace_id, idempotency_key, amount_minor, currency, description) VALUES (?, ?, ?, ?, ?)`)
    .run(workspace.id, key, input.amountMinor, currency, (input.description ?? '').trim().slice(0, 500));
  return getIntent(workspace.id, Number(result.lastInsertRowid));
}

export function setComplianceStatus(userId: number, workspaceId: number, intentId: number, status: 'approved' | 'rejected'): PaymentIntent {
  requireWorkspaceMember(userId, workspaceId);
  const intent = getIntent(workspaceId, intentId);
  if (intent.status !== 'pending') throw Object.assign(new Error('Only pending payments can be reviewed.'), { status: 409 });
  getDb().prepare('UPDATE payment_intents SET compliance_status = ? WHERE id = ?').run(status, intentId);
  return getIntent(workspaceId, intentId);
}

export function settlePayment(userId: number, workspaceId: number, intentId: number): PaymentIntent {
  requireWorkspaceMember(userId, workspaceId);
  const db = getDb();
  const intent = getIntent(workspaceId, intentId);
  if (intent.complianceStatus !== 'approved') throw Object.assign(new Error('Payment must pass compliance review before settlement.'), { status: 403 });
  if (intent.status === 'settled') return intent;
  if (intent.status !== 'pending' && intent.status !== 'authorized') throw Object.assign(new Error('Payment cannot be settled in its current state.'), { status: 409 });
  db.transaction(() => {
    db.prepare("UPDATE payment_intents SET status = 'settled', settled_at = datetime('now') WHERE id = ?").run(intentId);
    db.prepare("INSERT OR IGNORE INTO ledger_entries (workspace_id, payment_intent_id, entry_type, amount_minor, currency, reference) VALUES (?, ?, 'credit', ?, ?, ?)")
      .run(workspaceId, intentId, intent.amountMinor, intent.currency, `payment:${intentId}`);
    allocateCreatorShare(workspaceId, intentId, intent.amountMinor, intent.currency);
  })();
  return getIntent(workspaceId, intentId);
}

export function getBalance(userId: number, workspaceId: number) {
  const workspace = requireWorkspaceMember(userId, workspaceId);
  const row = getDb().prepare(`SELECT COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN -amount_minor ELSE amount_minor END), 0) AS balance FROM ledger_entries WHERE workspace_id = ?`).get(workspaceId) as { balance: number };
  return { workspaceId, currency: workspace.currency, balanceMinor: row.balance };
}