import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { listSecurityProfiles, listSecurityIncidents, reportSecurityIncident, updateSecurityIncident, updateSecurityProfile, RESPONSE_STEPS } from '../services/security-center.js';

export const securityCenterRouter = Router();
const profileSchema = z.object({ dataClassification: z.string(), retentionDays: z.number().int(), incidentContact: z.string().max(254), reviewStatus: z.string() }).strict();
const incidentSchema = z.object({ workspaceId: z.number().int().positive().optional(), severity: z.string(), title: z.string().min(1).max(160), summary: z.string().min(1).max(4000) }).strict();
const incidentUpdateSchema = z.object({ status: z.string(), containmentNote: z.string().max(4000).default('') }).strict();
function userId(req: Request): number { return (req as Request & { user: { userId: number } }).user.userId; }

securityCenterRouter.get('/response-steps', (_req, res) => res.json({ steps: RESPONSE_STEPS }));
securityCenterRouter.get('/profiles', (req, res) => res.json({ profiles: listSecurityProfiles(userId(req)) }));
securityCenterRouter.put('/profiles/:workspaceId', (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: 'Invalid security profile.', type: 'invalid_request_error' } }); return; }
  res.json({ profile: updateSecurityProfile(userId(req), Number(req.params.workspaceId), parsed.data) });
});
securityCenterRouter.get('/incidents', (req, res) => res.json({ incidents: listSecurityIncidents(userId(req)) }));
securityCenterRouter.post('/incidents', (req, res) => {
  const parsed = incidentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: 'Incident title and summary are required.', type: 'invalid_request_error' } }); return; }
  res.status(201).json({ incident: reportSecurityIncident(userId(req), parsed.data) });
});
securityCenterRouter.patch('/incidents/:id', (req, res) => {
  const parsed = incidentUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: 'Invalid incident update.', type: 'invalid_request_error' } }); return; }
  res.json({ incident: updateSecurityIncident(userId(req), Number(req.params.id), parsed.data.status, parsed.data.containmentNote) });
});