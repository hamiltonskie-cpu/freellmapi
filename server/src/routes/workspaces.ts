import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createWorkspace, listWorkspaces } from '../services/workspaces.js';
import type { IndustryCode, PaymentProvider } from '../services/workspaces.js';

export const workspacesRouter = Router();
const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['company', 'hospital']),
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/).optional(),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).optional(),
  paymentProvider: z.enum(['internal', 'payfast', 'yoco']).optional(),
  industryCode: z.enum(['healthcare', 'financial-services', 'retail', 'logistics', 'professional-services']).optional(),
}).strict();

function userId(req: Request): number {
  return (req as Request & { user: { userId: number } }).user.userId;
}

workspacesRouter.get('/', (req: Request, res: Response) => {
  res.json({ workspaces: listWorkspaces(userId(req)) });
});

workspacesRouter.post('/', (req: Request, res: Response) => {
  const parsed = workspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(error => error.message).join(', '), type: 'invalid_request_error' } });
    return;
  }
  res.status(201).json({ workspace: createWorkspace(userId(req), parsed.data.name, parsed.data.kind, parsed.data.currency, parsed.data.countryCode, parsed.data.paymentProvider as PaymentProvider | undefined, parsed.data.industryCode as IndustryCode | undefined) });
});