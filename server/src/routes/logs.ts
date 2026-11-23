import { Router } from 'express';
import {
  clearCommandLogs,
  getCommandLogs,
  subscribeCommandLogsSse,
} from '../utils/commandLogger';

export const logsRouter = Router();

logsRouter.get('/', (_req, res) => {
  res.json(getCommandLogs());
});

logsRouter.get('/stream', (req, res) => {
  subscribeCommandLogsSse(req, res);
});

logsRouter.delete('/', (_req, res) => {
  clearCommandLogs();
  res.json({ ok: true });
});
