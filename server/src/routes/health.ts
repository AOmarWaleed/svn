import { Router } from 'express';
import type { HealthInfo } from '../../../shared/types';
import {
  detectInstalledSvnPaths,
  getActiveRepoRoot,
  getCachedDetectedSvnPaths,
  getSampleRepoRoot,
  getSettings,
  testSvnExecutable,
} from '../config/store';
import { detectVsCodePath } from '../utils/vscodeLauncher';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res, next) => {
  try {
    const settings = getSettings();
    const detected =
      getCachedDetectedSvnPaths().length > 0
        ? getCachedDetectedSvnPaths()
        : await detectInstalledSvnPaths();
    const [svnTest, vscodePath] = await Promise.all([
      testSvnExecutable(settings.svnPath),
      detectVsCodePath(),
    ]);

    const info: HealthInfo = {
      ok: true,
      mode: settings.mode,
      activeRepoRoot: getActiveRepoRoot(),
      sampleRepoRoot: getSampleRepoRoot(),
      svnAvailable: svnTest.available,
      svnVersion: svnTest.version,
      svnPath: settings.svnPath,
      detectedSvnPaths: detected,
      vscodeAvailable: Boolean(vscodePath),
      vscodePath,
      editorCommand: settings.editorCommand,
      platform: process.platform,
    };
    res.json(info);
  } catch (err) {
    next(err);
  }
});
