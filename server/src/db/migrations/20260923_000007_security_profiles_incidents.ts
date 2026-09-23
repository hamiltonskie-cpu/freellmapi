import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_security_profiles (
      workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      data_classification TEXT NOT NULL DEFAULT 'internal' CHECK (data_classification IN ('public', 'internal', 'confidential', 'restricted')),
      retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 1 AND 3650),
      incident_contact TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('needs_review', 'current', 'overdue')),
      last_reviewed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS security_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
      reported_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      status TEXT NOT NULL DEFAULT 'triage' CHECK (status IN ('triage', 'contained', 'resolved', 'false_alarm')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      containment_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_security_incidents_workspace ON security_incidents(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_security_incidents_status ON security_incidents(status, severity);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_security_incidents_status;
    DROP INDEX IF EXISTS idx_security_incidents_workspace;
    DROP TABLE IF EXISTS security_incidents;
    DROP TABLE IF EXISTS workspace_security_profiles;
  `);
}