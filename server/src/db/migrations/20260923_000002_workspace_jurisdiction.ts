import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    ALTER TABLE workspaces ADD COLUMN country_code TEXT NOT NULL DEFAULT 'US';
    ALTER TABLE workspaces ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'internal';
    ALTER TABLE payment_intents ADD COLUMN provider_reference TEXT;
  `);
}

export function down(db: Db): void {
  db.prepare('ALTER TABLE payment_intents DROP COLUMN provider_reference').run();
  db.prepare('ALTER TABLE workspaces DROP COLUMN payment_provider').run();
  db.prepare('ALTER TABLE workspaces DROP COLUMN country_code').run();
}