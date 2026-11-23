import express, { Router } from 'express';
import type { UpdateSettingsPayload } from '../../../shared/types';
import {
  appendOperationHistory,
  detectInstalledSvnPaths,
  getPublicSettings,
  testSvnExecutable,
  updateSettings,
} from '../config/store';
import { getDemoProvider } from '../providers/providerManager';
import { clearCommandLogs, recordInstantCommandLog } from '../utils/commandLogger';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json(getPublicSettings());
});

settingsRouter.put('/', async (req, res, next) => {
  try {
    const payload = (req.body ?? {}) as UpdateSettingsPayload;
    const updated = await updateSettings(payload);
    await appendOperationHistory({
      action: 'settings.update',
      details: `Updated settings (mode: ${updated.mode})`,
      status: 'success',
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

settingsRouter.post('/test-svn', async (req, res, next) => {
  try {
    const svnPath = String(req.body?.svnPath ?? '').trim() || 'svn';
    const result = await testSvnExecutable(svnPath);
    const detected = await detectInstalledSvnPaths();
    res.json({ ...result, detectedSvnPaths: detected });
  } catch (err) {
    next(err);
  }
});

export async function resetDemoHandler(_req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  try {
    getDemoProvider().resetDemo();
    clearCommandLogs();
    recordInstantCommandLog({
      command: 'demo reset --restore-initial-state',
      status: 'success',
      output: 'Demo sandbox reset to initial 4 branches and unmerged feature commits.',
      durationMs: 25,
    });
    await appendOperationHistory({
      action: 'demo.reset',
      details: 'Reset Demo Sandbox to initial state',
      status: 'success',
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

settingsRouter.post('/demo/reset', resetDemoHandler);
