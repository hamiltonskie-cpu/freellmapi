import type { Db } from '../types.js';

export function up(db: Db): void {
  db.prepare("ALTER TABLE workspace_bots ADD COLUMN engineering_template_version INTEGER NOT NULL DEFAULT 1").run();
  db.exec(`
    INSERT OR IGNORE INTO workspace_bots (workspace_id, slug, name, purpose, category)
    SELECT id, 'engineering-assistant', 'Engineering assistant',
      'Turns client needs into technical work, release checks, and reliability follow-ups.', 'operations'
    FROM workspaces;
  `);
}

export function down(db: Db): void {
  db.prepare("DELETE FROM workspace_bots WHERE slug = 'engineering-assistant'").run();
  db.prepare('ALTER TABLE workspace_bots DROP COLUMN engineering_template_version').run();
}