import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creator_payout_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('paypal')),
      country_code TEXT NOT NULL,
      encrypted_account_ref TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      share_bps INTEGER NOT NULL DEFAULT 7000 CHECK (share_bps BETWEEN 1 AND 10000),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS creator_payout_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_intent_id INTEGER NOT NULL REFERENCES payment_intents(id) ON DELETE RESTRICT,
      payout_account_id INTEGER NOT NULL REFERENCES creator_payout_accounts(id) ON DELETE RESTRICT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'paid', 'failed')),
      provider_reference TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (payment_intent_id, payout_account_id)
    );

    CREATE INDEX IF NOT EXISTS idx_creator_payout_accounts_owner ON creator_payout_accounts(owner_user_id, priority);
    CREATE INDEX IF NOT EXISTS idx_creator_payout_allocations_status ON creator_payout_allocations(status, created_at);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_creator_payout_allocations_status;
    DROP INDEX IF EXISTS idx_creator_payout_accounts_owner;
    DROP TABLE IF EXISTS creator_payout_allocations;
    DROP TABLE IF EXISTS creator_payout_accounts;
  `);
}