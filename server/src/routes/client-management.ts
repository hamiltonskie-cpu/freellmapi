import { Router } from 'express';
import type { Request, Response } from 'express';
import { approveClientApplication, createClientAccessLink, listClientApplications, revokeWorkspaceClientLinks } from '../services/client-access.js';

export const clientManagementRouter = Router();
function userId(req: Request): number { return (req as Request & { user: { userId: number } }).user.userId; }

clientManagementRouter.get('/applications', (req: Request, res: Response) => res.json({ applications: listClientApplications(userId(req)) }));
clientManagementRouter.post('/applications/:workspaceId/approve', (req: Request, res: Response) => res.json(approveClientApplication(userId(req), Number(req.params.workspaceId))));
clientManagementRouter.post('/applications/:workspaceId/access-link', (req: Request, res: Response) => res.status(201).json(createClientAccessLink(userId(req), Number(req.params.workspaceId))));
clientManagementRouter.post('/applications/:workspaceId/revoke-links', (req: Request, res: Response) => res.json(revokeWorkspaceClientLinks(userId(req), Number(req.params.workspaceId))));