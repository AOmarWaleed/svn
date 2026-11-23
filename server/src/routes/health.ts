import { Router } from 'express';
import type { HealthInfo } from '../../../shared/types';
import {
  detectInstalledSvnPaths,
  getCachedDetectedSvnPaths,
  getSettings,
  testSvnExecutable,
} from '../config/store';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res, next) => {
  try {
    const settings = getSettings();
    const detected =
      getCachedDetectedSvnPaths().length > 0
        ? getCachedDetectedSvnPaths()
        : await detectInstalledSvnPaths();
    const svnTest = await testSvnExecutable(settings.svnPath);

    const info: HealthInfo = {
      ok: true,
      mode: settings.mode,
      svnAvailable: svnTest.available,
      svnVersion: svnTest.version,
      svnPath: settings.svnPath,
      detectedSvnPaths: detected,
      editorCommand: settings.editorCommand,
      platform: process.platform,
    };
    res.json(info);
  } catch (err) {
    next(err);
  }
});
