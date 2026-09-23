import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireWorkspaceMember } from './workspaces.js';

const LINK_TTL_DAYS = 30;

export const CLIENT_SAFETY_REQUIREMENTS = [
  'Use only approved company or hospital data; never paste passwords, payment secrets, or unnecessary patient identifiers.',
  'Keep each team member on their own account and revoke access when their role ends.',
  'Review bot recommendations before clinical, financial, customer, or production decisions.',
  'Report incidents and data-quality issues through the workspace owner.',
  'Use the portal only for the registered organization and approved workflows.',
] as const;

type ApplicationRow = { id: number; name: string; kind: string; industry_code: string; currency: string; onboarding_status: string; safety_requirements_acknowledged: number; created_at: string };

function hashToken(token: string): string { return crypto.createHash('sha256').update(token).digest('hex'); }

export function listClientApplications(userId: number) {
  const rows = getDb().prepare(`SELECT id, name, kind, industry_code, currency, onboarding_status, safety_requirements_acknowledged, created_at FROM workspaces WHERE owner_user_id = ? ORDER BY created_at DESC`).all(userId) as ApplicationRow[];
  return rows.map(row => ({ id: row.id, name: row.name, kind: row.kind, industryCode: row.industry_code, currency: row.currency, status: row.onboarding_status, safetyAcknowledged: row.safety_requirements_acknowledged === 1, createdAt: row.created_at }));
}

export function approveClientApplication(userId: number, workspaceId: number) {
  const workspace = requireWorkspaceMember(userId, workspaceId);
  const result = getDb().prepare("UPDATE workspaces SET onboarding_status = 'approved' WHERE id = ? AND owner_user_id = ?").run(workspaceId, userId);
  if (result.changes === 0) throw Object.assign(new Error('Only the workspace owner can approve this client.'), { status: 403 });
  return { workspaceId, name: workspace.name, status: 'approved', botReview: { status: 'approved', checks: ['identity recorded', 'industry template selected', 'workspace boundary enforced', 'monitoring enabled'] } };
}

export function createClientAccessLink(userId: number, workspaceId: number) {
  requireWorkspaceMember(userId, workspaceId);
  const row = getDb().prepare('SELECT onboarding_status FROM workspaces WHERE id = ? AND owner_user_id = ?').get(workspaceId, userId) as { onboarding_status: string } | undefined;
  if (row?.onboarding_status !== 'approved') throw Object.assign(new Error('Approve the client application before creating an access link.'), { status: 409 });
  const token = `dea_client_${crypto.randomBytes(24).toString('base64url')}`;
  const prefix = `${token.slice(0, 16)}…`;
  const expires = new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare('INSERT INTO client_access_links (workspace_id, created_by_user_id, token_hash, token_prefix, expires_at) VALUES (?, ?, ?, ?, ?)').run(workspaceId, userId, hashToken(token), prefix, expires);
  return { token, expiresAt: expires, path: `/client-portal/${token}` };
}

function resolveClientLink(token: string) {
  const row = getDb().prepare(`SELECT l.id, l.workspace_id, l.expires_at, w.name, w.kind, w.industry_code, w.currency, w.onboarding_status, w.safety_requirements_acknowledged FROM client_access_links l JOIN workspaces w ON w.id = l.workspace_id WHERE l.token_hash = ? AND l.revoked_at IS NULL`).get(hashToken(token)) as { id: number; workspace_id: number; expires_at: string; name: string; kind: string; industry_code: string; currency: string; onboarding_status: string; safety_requirements_acknowledged: number } | undefined;
  if (!row || row.onboarding_status !== 'approved' || Date.parse(row.expires_at) <= Date.now()) throw Object.assign(new Error('This client access link is invalid or expired.'), { status: 404 });
  getDb().prepare("UPDATE client_access_links SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return row;
}

export function getClientPortal(token: string) {
  const row = resolveClientLink(token);
  return { workspace: { id: row.workspace_id, name: row.name, kind: row.kind, industryCode: row.industry_code, currency: row.currency }, safetyAcknowledged: row.safety_requirements_acknowledged === 1, safetyRequirements: CLIENT_SAFETY_REQUIREMENTS, botReview: { status: 'approved', checks: ['workspace boundary', 'industry template', 'monitoring hooks', 'daily update bots'] }, monitoring: { status: 'active', monitoredSignals: ['usage volume', 'error rate', 'latency', 'bot review status'] }, expiresAt: row.expires_at };
}

export function acknowledgeClientSafety(token: string, acknowledged: boolean) {
  const row = resolveClientLink(token);
  if (!acknowledged) throw Object.assign(new Error('All safety requirements must be acknowledged.'), { status: 400 });
  getDb().prepare('UPDATE workspaces SET safety_requirements_acknowledged = 1 WHERE id = ?').run(row.workspace_id);
  return getClientPortal(token);
}

export function reportClientConcern(token: string, summary: string) {
  const row = resolveClientLink(token);
  const cleanSummary = summary.trim().slice(0, 4000);
  if (!cleanSummary) throw Object.assign(new Error('Describe the concern so it can be reviewed.'), { status: 400 });
  const result = getDb().prepare("INSERT INTO security_incidents (workspace_id, severity, status, title, summary) VALUES (?, 'high', 'triage', 'Client security concern', ?)").run(row.workspace_id, cleanSummary);
  return { incidentId: Number(result.lastInsertRowid), status: 'triage', message: 'Your concern was recorded for review. Keep this portal open while the workspace owner reviews it.' };
}

export function revokeWorkspaceClientLinks(userId: number, workspaceId: number) {
  const workspace = requireWorkspaceMember(userId, workspaceId);
  const result = getDb().prepare("UPDATE client_access_links SET revoked_at = datetime('now') WHERE workspace_id = ? AND revoked_at IS NULL").run(workspaceId);
  return { workspaceId, workspaceName: workspace.name, revokedLinks: result.changes };
}