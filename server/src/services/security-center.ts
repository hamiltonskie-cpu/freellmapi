import { getDb } from '../db/index.js';
import { requireWorkspaceMember } from './workspaces.js';

export const RESPONSE_STEPS = [
  'Acknowledge the report and assign one incident owner.',
  'Contain access: revoke exposed links, sessions, and client credentials.',
  'Preserve logs and record what is known, unknown, and still being checked.',
  'Notify the affected workspace owner through the verified contact channel.',
  'Resolve only after monitoring is clean and follow-up actions are recorded.',
] as const;

function ensureProfile(workspaceId: number): void {
  getDb().prepare('INSERT OR IGNORE INTO workspace_security_profiles (workspace_id) VALUES (?)').run(workspaceId);
}

export function listSecurityProfiles(userId: number) {
  const rows = getDb().prepare(`SELECT w.id, w.name, w.kind, w.industry_code, p.data_classification, p.retention_days, p.incident_contact, p.review_status, p.last_reviewed_at, p.updated_at FROM workspaces w LEFT JOIN workspace_security_profiles p ON p.workspace_id = w.id WHERE w.owner_user_id = ? ORDER BY w.name`).all(userId) as Record<string, unknown>[];
  for (const row of rows) ensureProfile(Number(row.id));
  return getDb().prepare(`SELECT w.id AS workspace_id, w.name, w.kind, w.industry_code, p.data_classification, p.retention_days, p.incident_contact, p.review_status, p.last_reviewed_at, p.updated_at FROM workspaces w JOIN workspace_security_profiles p ON p.workspace_id = w.id WHERE w.owner_user_id = ? ORDER BY w.name`).all(userId);
}

export function updateSecurityProfile(userId: number, workspaceId: number, input: { dataClassification: string; retentionDays: number; incidentContact: string; reviewStatus: string }) {
  requireWorkspaceMember(userId, workspaceId);
  if (!['public', 'internal', 'confidential', 'restricted'].includes(input.dataClassification)) throw Object.assign(new Error('Invalid data classification.'), { status: 400 });
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3650) throw Object.assign(new Error('Retention must be between 1 and 3650 days.'), { status: 400 });
  if (!['needs_review', 'current', 'overdue'].includes(input.reviewStatus)) throw Object.assign(new Error('Invalid review status.'), { status: 400 });
  ensureProfile(workspaceId);
  getDb().prepare(`UPDATE workspace_security_profiles SET data_classification = ?, retention_days = ?, incident_contact = ?, review_status = ?, last_reviewed_at = datetime('now'), updated_at = datetime('now') WHERE workspace_id = ?`).run(input.dataClassification, input.retentionDays, input.incidentContact.trim().slice(0, 254), input.reviewStatus, workspaceId);
  return listSecurityProfiles(userId).find((profile) => (profile as { workspace_id: number }).workspace_id === workspaceId);
}

export function listSecurityIncidents(userId: number) {
  return getDb().prepare(`SELECT i.id, i.workspace_id AS workspaceId, w.name AS workspaceName, i.severity, i.status, i.title, i.summary, i.containment_note AS containmentNote, i.created_at AS createdAt, i.updated_at AS updatedAt, i.resolved_at AS resolvedAt FROM security_incidents i LEFT JOIN workspaces w ON w.id = i.workspace_id WHERE w.owner_user_id = ? OR i.workspace_id IS NULL ORDER BY CASE i.status WHEN 'triage' THEN 0 WHEN 'contained' THEN 1 ELSE 2 END, i.created_at DESC`).all(userId);
}

export function reportSecurityIncident(userId: number, input: { workspaceId?: number; severity: string; title: string; summary: string }) {
  if (input.workspaceId) requireWorkspaceMember(userId, input.workspaceId);
  if (!['low', 'medium', 'high', 'critical'].includes(input.severity)) throw Object.assign(new Error('Invalid incident severity.'), { status: 400 });
  if (!input.title.trim() || !input.summary.trim()) throw Object.assign(new Error('Incident title and summary are required.'), { status: 400 });
  const result = getDb().prepare('INSERT INTO security_incidents (workspace_id, reported_by_user_id, severity, title, summary) VALUES (?, ?, ?, ?, ?)').run(input.workspaceId ?? null, userId, input.severity, input.title.trim().slice(0, 160), input.summary.trim().slice(0, 4000));
  return { id: Number(result.lastInsertRowid), status: 'triage', responseSteps: RESPONSE_STEPS };
}

export function updateSecurityIncident(userId: number, incidentId: number, status: string, containmentNote: string) {
  const row = getDb().prepare(`SELECT i.id FROM security_incidents i LEFT JOIN workspaces w ON w.id = i.workspace_id WHERE i.id = ? AND (w.owner_user_id = ? OR i.workspace_id IS NULL)`).get(incidentId, userId) as { id: number } | undefined;
  if (!row) throw Object.assign(new Error('Security incident not found.'), { status: 404 });
  if (!['triage', 'contained', 'resolved', 'false_alarm'].includes(status)) throw Object.assign(new Error('Invalid incident status.'), { status: 400 });
  getDb().prepare(`UPDATE security_incidents SET status = ?, containment_note = ?, updated_at = datetime('now'), resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE resolved_at END WHERE id = ?`).run(status, containmentNote.trim().slice(0, 4000), status, incidentId);
  return listSecurityIncidents(userId).find((incident) => (incident as { id: number }).id === incidentId);
}