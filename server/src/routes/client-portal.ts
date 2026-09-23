import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { acknowledgeClientSafety, getClientPortal, reportClientConcern } from '../services/client-access.js';

export const clientPortalRouter = Router();
const acknowledgeSchema = z.object({ acknowledged: z.literal(true) }).strict();
const concernSchema = z.object({ summary: z.string().trim().min(1).max(4000) }).strict();

clientPortalRouter.get('/:token', (req: Request, res: Response) => res.json(getClientPortal(String(req.params.token))));
clientPortalRouter.post('/:token/acknowledge', (req: Request, res: Response) => {
  const parsed = acknowledgeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: 'Safety requirements must be acknowledged.', type: 'invalid_request_error' } }); return; }
  res.json(acknowledgeClientSafety(String(req.params.token), parsed.data.acknowledged));
});

clientPortalRouter.post('/:token/report', (req: Request, res: Response) => {
  const parsed = concernSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: { message: 'Describe the concern so it can be reviewed.', type: 'invalid_request_error' } }); return; }
  res.status(201).json(reportClientConcern(String(req.params.token), parsed.data.summary));
});