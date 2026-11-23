import { Router } from 'express';
import { getActiveRepoRoot, getModuleById, getSettings } from '../config/store';
import { resolveInsideRoot } from '../utils/pathSafety';
import { openFilesInEditor, openFolderInExplorer } from '../utils/vscodeLauncher';

export const systemRouter = Router();

systemRouter.post('/open-folder', (req, res, next) => {
  try {
    const { moduleId, envId } = req.body ?? {};
    const repoRoot = getActiveRepoRoot();
    let targetPath = repoRoot;

    if (moduleId && envId) {
      const mod = getModuleById(String(moduleId));
      const rel = mod.paths[String(envId)];
      if (!rel) {
        res.status(400).json({ error: 'No mapped path for this module/environment.' });
        return;
      }
      targetPath = resolveInsideRoot(repoRoot, rel);
    }

    openFolderInExplorer(targetPath);
    res.json({ ok: true, path: targetPath });
  } catch (err) {
    next(err);
  }
});

systemRouter.post('/open-vscode-folder', async (req, res, next) => {
  try {
    const { moduleId, envId } = req.body ?? {};
    const repoRoot = getActiveRepoRoot();
    let targetPath = repoRoot;

    if (moduleId && envId) {
      const mod = getModuleById(String(moduleId));
      const rel = mod.paths[String(envId)];
      if (!rel) {
        res.status(400).json({ error: 'No mapped path for this module/environment.' });
        return;
      }
      targetPath = resolveInsideRoot(repoRoot, rel);
    }

    const settings = getSettings();
    const bin = await openFilesInEditor([targetPath], settings.editorCommand);
    res.json({ ok: true, launched: bin, path: targetPath });
  } catch (err) {
    next(err);
  }
});
