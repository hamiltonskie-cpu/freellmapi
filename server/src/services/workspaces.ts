import { getDb } from '../db/index.js';

export type WorkspaceKind = 'company' | 'hospital';
export type Workspace = {
  id: number;
  name: string;
  kind: WorkspaceKind;
  currency: string;
  countryCode: string;
  paymentProvider: PaymentProvider;
  industryCode: IndustryCode;
  createdAt: string;
};
export type PaymentProvider = 'internal' | 'payfast' | 'yoco';
export type IndustryCode = 'healthcare' | 'financial-services' | 'retail' | 'logistics' | 'professional-services';

type WorkspaceRow = { id: number; name: string; kind: WorkspaceKind; currency: string; country_code: string; payment_provider: PaymentProvider; industry_code: IndustryCode; created_at: string };

function toWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, name: row.name, kind: row.kind, currency: row.currency, countryCode: row.country_code, paymentProvider: row.payment_provider, industryCode: row.industry_code, createdAt: row.created_at };
}

export function listWorkspaces(userId: number): Workspace[] {
  const rows = getDb().prepare(`
    SELECT w.id, w.name, w.kind, w.currency, w.country_code, w.payment_provider, w.industry_code, w.created_at
    FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id
    WHERE m.user_id = ?
    ORDER BY w.created_at, w.id
  `).all(userId) as WorkspaceRow[];
  return rows.map(toWorkspace);
}

export function requireWorkspaceMember(userId: number, workspaceId: number): Workspace {
  const row = getDb().prepare(`
    SELECT w.id, w.name, w.kind, w.currency, w.country_code, w.payment_provider, w.industry_code, w.created_at
    FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id
    WHERE w.id = ? AND m.user_id = ?
  `).get(workspaceId, userId) as WorkspaceRow | undefined;
  if (!row) throw Object.assign(new Error('Workspace not found.'), { status: 404 });
  return toWorkspace(row);
}

export function createWorkspace(userId: number, name: string, kind: WorkspaceKind, currency = 'USD', countryCode = 'US', paymentProvider: PaymentProvider = 'internal', industryCode: IndustryCode = 'healthcare'): Workspace {
  const normalizedName = name.trim();
  const normalizedCurrency = currency.trim().toUpperCase();
  const normalizedCountry = countryCode.trim().toUpperCase();
  if (!normalizedName || normalizedName.length > 120) throw Object.assign(new Error('Workspace name must be 1-120 characters.'), { status: 400 });
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw Object.assign(new Error('Currency must be an ISO 4217 code.'), { status: 400 });
  if (!/^[A-Z]{2}$/.test(normalizedCountry)) throw Object.assign(new Error('Country must be an ISO 3166-1 alpha-2 code.'), { status: 400 });
  if (!SUPPORTED_PAYMENT_PROVIDERS.includes(paymentProvider)) throw Object.assign(new Error('Unsupported payment provider.'), { status: 400 });
  if (!SUPPORTED_INDUSTRIES.includes(industryCode)) throw Object.assign(new Error('Unsupported industry.'), { status: 400 });
  if (paymentProvider !== 'internal' && (normalizedCountry !== 'ZA' || normalizedCurrency !== 'ZAR')) {
    throw Object.assign(new Error('South African providers require country ZA and currency ZAR.'), { status: 400 });
  }

  const db = getDb();
  const create = db.transaction(() => {
    const result = db.prepare('INSERT INTO workspaces (owner_user_id, name, kind, currency, country_code, payment_provider, industry_code) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, normalizedName, kind, normalizedCurrency, normalizedCountry, paymentProvider, industryCode);
    const workspaceId = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, \'owner\')').run(workspaceId, userId);
    for (const bot of DEFAULT_BOTS) {
      db.prepare('INSERT INTO workspace_bots (workspace_id, slug, name, purpose, category) VALUES (?, ?, ?, ?, ?)')
        .run(workspaceId, bot.slug, bot.name, bot.purpose, bot.category);
    }
    return workspaceId;
  })();
  return requireWorkspaceMember(userId, Number(create));
}

export const DEFAULT_BOTS = [
  { slug: 'sales-assistant', name: 'Sales assistant', purpose: 'Qualifies inbound leads and prepares follow-up actions.', category: 'sales' },
  { slug: 'marketing-assistant', name: 'Marketing assistant', purpose: 'Creates campaign ideas and tracks outreach opportunities.', category: 'marketing' },
  { slug: 'staffing-update', name: 'Staffing update', purpose: 'Summarizes coverage, open shifts, and staffing risks.', category: 'staffing' },
  { slug: 'operations-update', name: 'Operations update', purpose: 'Summarizes daily operational activity and exceptions.', category: 'operations' },
  { slug: 'finance-update', name: 'Finance update', purpose: 'Summarizes ledger activity, balances, and payment reviews.', category: 'finance' },
  { slug: 'engineering-assistant', name: 'Engineering assistant', purpose: 'Turns client needs into technical work, release checks, and reliability follow-ups.', category: 'operations' },
] as const;

export const SUPPORTED_PAYMENT_PROVIDERS: readonly PaymentProvider[] = ['internal', 'payfast', 'yoco'];
export const SUPPORTED_INDUSTRIES: readonly IndustryCode[] = ['healthcare', 'financial-services', 'retail', 'logistics', 'professional-services'];