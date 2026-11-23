import express, { Router } from 'express';
import type { UpdateSettingsPayload } from '../../../shared/types';
import {
  appendOperationHistory,
  detectInstalledSvnPaths,
  getPublicSettings,
  testSvnExecutable,
  updateSettings,
} from '../config/store';
import { clearAllTrackedConflicts } from '../engines/conflictTracker';
import { ensureSampleRepoInitialized, resetSampleRepo } from '../sample/sampleRcmBuilder';
import { clearCommandLogs, recordInstantCommandLog } from '../utils/commandLogger';
import { detectVsCodePath } from '../utils/vscodeLauncher';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json(getPublicSettings());
});

settingsRouter.put('/', async (req, res, next) => {
  try {
    const payload = (req.body ?? {}) as UpdateSettingsPayload;
    const updated = await updateSettings(payload);
    if (updated.mode === 'sample') {
      await ensureSampleRepoInitialized();
    }
    await appendOperationHistory({
      action: 'settings.update',
      details: `Updated settings (mode: ${updated.mode}, root: ${updated.activeRepoRoot})`,
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
    const [result, detected] = await Promise.all([
      testSvnExecutable(svnPath),
      detectInstalledSvnPaths(),
    ]);
    res.json({ ...result, detectedSvnPaths: detected });
  } catch (err) {
    next(err);
  }
});

settingsRouter.post('/test-vscode', async (_req, res, next) => {
  try {
    const vscodePath = await detectVsCodePath();
    res.json({
      available: Boolean(vscodePath),
      vscodePath,
    });
  } catch (err) {
    next(err);
  }
});

export async function resetSampleHandler(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  try {
    clearAllTrackedConflicts();
    const root = await resetSampleRepo();
    clearCommandLogs();
    recordInstantCommandLog({
      command: `sample-rcm reset "${root}"`,
      status: 'success',
      output: 'Sample RCM repository restored cleanly to initial r7425 state.',
      durationMs: 40,
    });
    await appendOperationHistory({
      action: 'sample.reset',
      details: 'Reset Sample RCM repository on disk to initial state',
      status: 'success',
    });
    res.json({ ok: true, sampleRepoRoot: root });
  } catch (err) {
    next(err);
  }
}
