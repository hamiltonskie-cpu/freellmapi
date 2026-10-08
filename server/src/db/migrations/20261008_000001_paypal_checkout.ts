import type { Db } from '../types.js';

export function up(db: Db): void {
  db.prepare('ALTER TABLE payment_intents ADD COLUMN paypal_approval_url TEXT').run();
  db.exec(`
    CREATE TABLE IF NOT EXISTS paypal_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      capture_id TEXT,
      payment_intent_id INTEGER REFERENCES payment_intents(id) ON DELETE SET NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function down(db: Db): void {
  db.exec('DROP TABLE IF EXISTS paypal_webhook_events');
  db.prepare('ALTER TABLE payment_intents DROP COLUMN paypal_approval_url').run();
}