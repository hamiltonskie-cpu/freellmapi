import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('company', 'hospital')),
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'member')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS payment_intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      currency TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'settled', 'canceled', 'failed')),
      compliance_status TEXT NOT NULL DEFAULT 'review' CHECK (compliance_status IN ('review', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      settled_at TEXT,
      UNIQUE (workspace_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      payment_intent_id INTEGER REFERENCES payment_intents(id) ON DELETE RESTRICT,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('credit', 'debit', 'refund')),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      currency TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('sales', 'marketing', 'operations', 'staffing', 'finance')),
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      UNIQUE (workspace_id, slug)
    );

    CREATE TABLE IF NOT EXISTS bot_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id INTEGER NOT NULL REFERENCES workspace_bots(id) ON DELETE CASCADE,
      run_day TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (bot_id, run_day)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_payment_intents_workspace ON payment_intents(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_bot_runs_bot_day ON bot_runs(bot_id, run_day);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_bot_runs_bot_day;
    DROP INDEX IF EXISTS idx_payment_intents_workspace;
    DROP INDEX IF EXISTS idx_workspace_members_user;
    DROP TABLE IF EXISTS bot_runs;
    DROP TABLE IF EXISTS workspace_bots;
    DROP TABLE IF EXISTS ledger_entries;
    DROP TABLE IF EXISTS payment_intents;
    DROP TABLE IF EXISTS workspace_members;
    DROP TABLE IF EXISTS workspaces;
  `);
}