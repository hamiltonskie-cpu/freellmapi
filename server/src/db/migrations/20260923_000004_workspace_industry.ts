import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`ALTER TABLE workspaces ADD COLUMN industry_code TEXT NOT NULL DEFAULT 'healthcare';`);
}

export function down(db: Db): void {
  db.prepare('ALTER TABLE workspaces DROP COLUMN industry_code').run();
}