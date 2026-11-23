import { Router } from 'express';
import { appendOperationHistory, getSettings } from '../config/store';
import { getAllActiveConflicts, resolveConflictItem } from '../engines/svnEngine';
import { openDiffInVsCode, openFilesInEditor } from '../utils/vscodeLauncher';

export const conflictsRouter = Router();

conflictsRouter.get('/', async (_req, res, next) => {
  try {
    const items = await getAllActiveConflicts();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

conflictsRouter.post('/resolve', async (req, res, next) => {
  try {
    const { conflictId, strategy } = req.body ?? {};
    if (!conflictId || !['working', 'source', 'target'].includes(String(strategy))) {
      res.status(400).json({ error: 'conflictId and valid strategy (working|source|target) required.' });
      return;
    }
    const result = await resolveConflictItem(
      String(conflictId),
      strategy as 'working' | 'source' | 'target'
    );
    await appendOperationHistory({
      action: 'conflict.resolve',
      details: `Resolved conflict ${conflictId} (${strategy})`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

conflictsRouter.post('/open-vscode', async (req, res, next) => {
  try {
    const { conflictId, mode } = req.body ?? {};
    if (!conflictId) {
      res.status(400).json({ error: 'conflictId is required.' });
      return;
    }

    const items = await getAllActiveConflicts();
    const conflict = items.find((c) => c.id === conflictId);
    if (!conflict) {
      res.status(404).json({ error: `Conflict item not found: ${conflictId}` });
      return;
    }

    const settings = getSettings();
    if (mode === 'diff' && conflict.sourceFullPath) {
      const bin = await openDiffInVsCode(
        conflict.sourceFullPath,
        conflict.targetFullPath,
        settings.editorCommand
      );
      res.json({ ok: true, launched: bin, mode: 'diff', target: conflict.targetFullPath });
      return;
    }

    const bin = await openFilesInEditor([conflict.targetFullPath], settings.editorCommand);
    res.json({ ok: true, launched: bin, mode: 'file', target: conflict.targetFullPath });
  } catch (err) {
    next(err);
  }
});

conflictsRouter.post('/open-all-vscode', async (req, res, next) => {
  try {
    const { targetEnvId, moduleId } = req.body ?? {};
    const items = await getAllActiveConflicts();
    const filtered = items.filter((c) => {
      if (targetEnvId && c.targetEnvId !== targetEnvId) return false;
      if (moduleId && c.moduleId !== moduleId) return false;
      return true;
    });

    if (filtered.length === 0) {
      res.status(400).json({ error: 'No active conflicts to open.' });
      return;
    }

    const settings = getSettings();
    const paths = Array.from(new Set(filtered.map((f) => f.targetFullPath)));
    const bin = await openFilesInEditor(paths, settings.editorCommand);
    res.json({ ok: true, launched: bin, count: paths.length, paths });
  } catch (err) {
    next(err);
  }
});
