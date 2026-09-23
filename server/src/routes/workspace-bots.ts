import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getMonthlyWorkforcePlan, interactWithBot, listBotRuns, listBots } from '../services/workspace-bots.js';

export const workspaceBotsRouter = Router();
const messageSchema = z.object({ message: z.string().trim().min(1).max(2000) }).strict();

function userId(req: Request): number {
  return (req as Request & { user: { userId: number } }).user.userId;
}

workspaceBotsRouter.get('/:workspaceId', (req: Request, res: Response) => {
  res.json({ bots: listBots(userId(req), Number(req.params.workspaceId)) });
});

workspaceBotsRouter.get('/:workspaceId/:botId/runs', (req: Request, res: Response) => {
  res.json({ runs: listBotRuns(userId(req), Number(req.params.workspaceId), Number(req.params.botId)) });
});

workspaceBotsRouter.get('/:workspaceId/plan', (req: Request, res: Response) => {
  const target = req.query.targetMinor === undefined ? undefined : Number(req.query.targetMinor);
  res.json(getMonthlyWorkforcePlan(userId(req), Number(req.params.workspaceId), target));
});

workspaceBotsRouter.post('/:workspaceId/:botId/messages', (req: Request, res: Response) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'message is required.', type: 'invalid_request_error' } });
    return;
  }
  res.json(interactWithBot(userId(req), Number(req.params.workspaceId), Number(req.params.botId), parsed.data.message));
});