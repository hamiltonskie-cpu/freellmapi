import { getDb } from '../db/index.js';
import type { Scheduler } from '../lib/scheduler.js';
import { requireWorkspaceMember } from './workspaces.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const BOT_WORKFORCE = {
  'sales-assistant': { function: 'Qualify demand and route high-intent opportunities.', inputs: 'Leads, account activity, response history', output: 'Prioritized follow-up queue', cadence: 'Every business day', kpi: 'Qualified pipeline' },
  'marketing-assistant': { function: 'Turn customer signals into campaigns and experiments.', inputs: 'Segments, feedback, campaign results', output: 'Campaign briefs and experiment backlog', cadence: 'Weekly plus campaign events', kpi: 'Activated accounts' },
  'staffing-update': { function: 'Match workforce coverage to client demand and safety rules.', inputs: 'Shifts, skills, absences, workload', output: 'Coverage risks and staffing actions', cadence: 'Daily', kpi: 'Coverage rate' },
  'operations-update': { function: 'Find process exceptions before they become customer failures.', inputs: 'Queues, incidents, SLAs, handoffs', output: 'Exception list and owners', cadence: 'Daily', kpi: 'SLA adherence' },
  'finance-update': { function: 'Connect usage, collections, creator reserve, and operating costs.', inputs: 'Ledger, usage, invoices, costs', output: 'Cash and margin review', cadence: 'Daily with month-end close', kpi: 'Net contribution' },
  'engineering-assistant': { function: 'Convert client needs into safe, testable product delivery.', inputs: 'Requests, incidents, usage trends', output: 'Prioritized technical work and release checks', cadence: 'Daily triage plus release gates', kpi: 'Reliable delivery rate' },
} as const;

function today(): string { return new Date().toISOString().slice(0, 10); }

function makeSummary(category: string, workspaceName: string): string {
  const summaries: Record<string, string> = {
    sales: `Sales assistant reviewed new opportunities for ${workspaceName} and prepared follow-up actions.`,
    marketing: `Marketing assistant reviewed outreach activity for ${workspaceName} and prepared campaign suggestions.`,
    staffing: `Staffing update checked coverage and open assignments for ${workspaceName}.`,
    operations: `Operations update checked daily activity and exceptions for ${workspaceName}.`,
    finance: `Finance update checked payment reviews and ledger activity for ${workspaceName}.`,
  };
  return summaries[category] ?? `Daily update completed for ${workspaceName}.`;
}

export function runDailyBotUpdates(runDate = today()): number {
  const db = getDb();
  const bots = db.prepare(`SELECT b.id, b.category, w.name AS workspace_name FROM workspace_bots b JOIN workspaces w ON w.id = b.workspace_id WHERE b.enabled = 1`).all() as { id: number; category: string; workspace_name: string }[];
  const run = db.transaction(() => {
    let count = 0;
    for (const bot of bots) {
      const result = db.prepare(`INSERT OR IGNORE INTO bot_runs (bot_id, run_day, status, summary) VALUES (?, ?, 'completed', ?)`)
        .run(bot.id, runDate, makeSummary(bot.category, bot.workspace_name));
      if (result.changes > 0) {
        db.prepare("UPDATE workspace_bots SET last_run_at = datetime('now') WHERE id = ?").run(bot.id);
        count += 1;
      }
    }
    return count;
  });
  return Number(run());
}

export function listBots(userId: number, workspaceId: number) {
  requireWorkspaceMember(userId, workspaceId);
  return getDb().prepare('SELECT id, slug, name, purpose, category, enabled, last_run_at AS lastRunAt FROM workspace_bots WHERE workspace_id = ? ORDER BY id').all(workspaceId);
}

export function listBotRuns(userId: number, workspaceId: number, botId: number) {
  requireWorkspaceMember(userId, workspaceId);
  return getDb().prepare(`SELECT r.id, r.run_day AS runDay, r.status, r.summary, r.created_at AS createdAt FROM bot_runs r JOIN workspace_bots b ON b.id = r.bot_id WHERE b.workspace_id = ? AND b.id = ? ORDER BY r.run_day DESC LIMIT 30`).all(workspaceId, botId);
}

export function getMonthlyWorkforcePlan(userId: number, workspaceId: number, targetMinor = 100_000_000) {
  const workspace = requireWorkspaceMember(userId, workspaceId);
  if (!Number.isSafeInteger(targetMinor) || targetMinor < 1) throw Object.assign(new Error('targetMinor must be a positive safe integer.'), { status: 400 });
  const bots = getDb().prepare('SELECT id, slug, name, purpose, category FROM workspace_bots WHERE workspace_id = ? ORDER BY id').all(workspaceId) as { id: number; slug: string; name: string; purpose: string; category: string }[];
  return {
    workspace: { id: workspace.id, name: workspace.name, industryCode: workspace.industryCode, currency: workspace.currency },
    targetMinor,
    targetDisplay: `${(targetMinor / 100).toFixed(2)} ${workspace.currency}`,
    principle: 'Bots identify work and owners; humans approve customer, financial, clinical, and production decisions.',
    bots: bots.map((bot) => ({ ...bot, capability: BOT_WORKFORCE[bot.slug as keyof typeof BOT_WORKFORCE] ?? { function: bot.purpose, inputs: 'Workspace events', output: 'Action summary', cadence: 'Daily', kpi: 'Completion rate' } })),
    workforce: [
      { function: 'Growth', shareBps: 2500, owner: 'Sales and marketing bots' },
      { function: 'Delivery', shareBps: 3000, owner: 'Engineering and operations bots' },
      { function: 'Customer success', shareBps: 2000, owner: 'Staffing and operations bots' },
      { function: 'Finance and governance', shareBps: 1500, owner: 'Finance bot and human reviewer' },
      { function: 'Reserve', shareBps: 1000, owner: 'Creator reserve and contingencies' },
    ],
    milestones: ['Instrument client usage and consent', 'Validate the highest-value workflow', 'Ship a measured pilot', 'Review retention, margin, and safety', 'Scale only the workflows that pass review'],
  };
}

export function interactWithBot(userId: number, workspaceId: number, botId: number, message: string) {
  const workspace = requireWorkspaceMember(userId, workspaceId);
  const bot = getDb().prepare('SELECT name, category FROM workspace_bots WHERE id = ? AND workspace_id = ?').get(botId, workspaceId) as { name: string; category: string } | undefined;
  if (!bot) throw Object.assign(new Error('Bot not found.'), { status: 404 });
  const cleanMessage = message.trim().slice(0, 2000);
  if (!cleanMessage) throw Object.assign(new Error('Message is required.'), { status: 400 });
  return { bot: bot.name, workspace: workspace.name, reply: `${bot.name} received your request for ${workspace.name}. I will turn it into a ${bot.category} follow-up: ${cleanMessage}` };
}

export function startWorkspaceBotScheduler(scheduler: Scheduler): () => void {
  const run = () => {
    try { const count = runDailyBotUpdates(); if (count > 0) console.log(`[bots] completed ${count} daily workspace update${count === 1 ? '' : 's'}`); }
    catch (error) { console.error(`[bots] daily update failed: ${error instanceof Error ? error.message : String(error)}`); }
  };
  run();
  return scheduler.every(DAY_MS, run, { name: 'workspace-daily-bots' });
}