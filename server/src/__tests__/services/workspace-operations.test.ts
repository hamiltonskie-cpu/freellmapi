import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import { createPaymentIntent, getBalance, setComplianceStatus, settlePayment } from '../../services/billing-ledger.js';
import { getMonthlyWorkforcePlan, runDailyBotUpdates, listBots } from '../../services/workspace-bots.js';
import { createUser } from '../../services/auth.js';
import { createWorkspace } from '../../services/workspaces.js';
import { configureCreatorPayPal, listCreatorPayoutAccounts } from '../../services/creator-payouts.js';
import { approveClientApplication, createClientAccessLink, getClientPortal, reportClientConcern, revokeWorkspaceClientLinks } from '../../services/client-access.js';
import { listSecurityProfiles, reportSecurityIncident, updateSecurityIncident, updateSecurityProfile } from '../../services/security-center.js';

describe('workspace operations', () => {
  let userId: number;
  let workspaceId: number;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    userId = createUser('ops@example.test', 'correct horse battery staple').userId;
    workspaceId = createWorkspace(userId, 'Northstar Hospital', 'hospital').id;
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('seeds two growth bots and three daily update bots', () => {
    const bots = listBots(userId, workspaceId);
    expect(bots).toHaveLength(6);
    expect(bots.filter((bot) => bot.category === 'sales' || bot.category === 'marketing')).toHaveLength(2);
  });

  it('is idempotent and requires compliance before settlement', () => {
    const input = { workspaceId, amountMinor: 2500, currency: 'USD', description: 'Credits', idempotencyKey: 'test-payment-1' };
    const first = createPaymentIntent(userId, input);
    const retry = createPaymentIntent(userId, input);
    expect(retry.id).toBe(first.id);
    expect(() => settlePayment(userId, workspaceId, first.id)).toThrow('compliance');

    setComplianceStatus(userId, workspaceId, first.id, 'approved');
    expect(settlePayment(userId, workspaceId, first.id).status).toBe('settled');
    expect(getBalance(userId, workspaceId).balanceMinor).toBe(2500);
  });

  it('runs each bot once per day', () => {
    expect(runDailyBotUpdates('2026-09-23')).toBe(6);
    expect(runDailyBotUpdates('2026-09-23')).toBe(0);
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM bot_runs').get() as { count: number }).count).toBe(6);
  });

  it('builds a workforce plan around a monthly target', () => {
    const plan = getMonthlyWorkforcePlan(userId, workspaceId);
    expect(plan.targetMinor).toBe(100_000_000);
    expect(plan.bots.some((bot) => bot.slug === 'engineering-assistant')).toBe(true);
    expect(plan.workforce.reduce((total, item) => total + item.shareBps, 0)).toBe(10_000);
  });

  it('only permits South African providers for ZA workspaces using ZAR', () => {
    expect(() => createWorkspace(userId, 'Invalid Provider', 'company', 'USD', 'US', 'payfast')).toThrow('country ZA and currency ZAR');
    const southAfrica = createWorkspace(userId, 'Cape Town Clinic', 'hospital', 'ZAR', 'ZA', 'payfast');
    expect(southAfrica.countryCode).toBe('ZA');
    expect(southAfrica.paymentProvider).toBe('payfast');
    expect(() => createPaymentIntent(userId, { workspaceId: southAfrica.id, amountMinor: 1000, currency: 'ZAR', idempotencyKey: 'payfast-not-configured' })).toThrow('merchant adapter');
  });

  it('stores the creator PayPal account encrypted and returns only a mask', () => {
    const account = configureCreatorPayPal(userId, 'ZA', 'creator@example.com');
    expect(account.maskedAccount).toBe('cr***@example.com');
    expect(listCreatorPayoutAccounts(userId)[0]?.maskedAccount).toBe('cr***@example.com');
    const row = getDb().prepare('SELECT encrypted_account_ref FROM creator_payout_accounts WHERE id = ?').get(account.id) as { encrypted_account_ref: string };
    expect(row.encrypted_account_ref).not.toContain('creator@example.com');
  });

  it('requires founder approval before issuing a monitored client URL', () => {
    const pending = createWorkspace(userId, 'Client Portal Hospital', 'hospital');
    expect(() => createClientAccessLink(userId, pending.id)).toThrow('Approve the client application');
    approveClientApplication(userId, pending.id);
    const link = createClientAccessLink(userId, pending.id);
    expect(link.path).toContain('/client-portal/');
    expect(getClientPortal(link.token).monitoring.status).toBe('active');
  });

  it('maintains profiles and moves incidents through calm response states', () => {
    const profile = listSecurityProfiles(userId).find((item) => (item as { workspace_id: number }).workspace_id === workspaceId) as { data_classification: string; retention_days: number } | undefined;
    expect(profile?.data_classification).toBe('internal');
    updateSecurityProfile(userId, workspaceId, { dataClassification: 'confidential', retentionDays: 180, incidentContact: 'security@example.test', reviewStatus: 'current' });
    const incident = reportSecurityIncident(userId, { workspaceId, severity: 'medium', title: 'Unusual access signal', summary: 'A monitored client generated an unexpected access pattern.' });
    expect(incident.status).toBe('triage');
    expect(updateSecurityIncident(userId, incident.id, 'contained', 'Access link revoked and logs preserved.')).toMatchObject({ status: 'contained' });
    expect(updateSecurityIncident(userId, incident.id, 'resolved', 'Review completed with no further signal.')).toMatchObject({ status: 'resolved' });
  });

  it('lets a client report a concern and lets the founder revoke portal links', () => {
    const workspace = createWorkspace(userId, 'Emergency Access Hospital', 'hospital');
    approveClientApplication(userId, workspace.id);
    const link = createClientAccessLink(userId, workspace.id);
    expect(reportClientConcern(link.token, 'A team member saw an unexpected sign-in prompt.').status).toBe('triage');
    expect(revokeWorkspaceClientLinks(userId, workspace.id).revokedLinks).toBe(1);
    expect(() => getClientPortal(link.token)).toThrow('invalid or expired');
  });
});