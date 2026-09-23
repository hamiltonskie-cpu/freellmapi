import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    ALTER TABLE workspaces ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE workspaces ADD COLUMN safety_requirements_acknowledged INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS client_access_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_client_access_links_workspace ON client_access_links(workspace_id, revoked_at);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_client_access_links_workspace;
    DROP TABLE IF EXISTS client_access_links;
  `);
  db.prepare('ALTER TABLE workspaces DROP COLUMN safety_requirements_acknowledged').run();
  db.prepare('ALTER TABLE workspaces DROP COLUMN onboarding_status').run();
}