import { Router } from 'express';
import type { ConflictListItem, ConflictQuickStrategy } from '../../../shared/types';
import { appendOperationHistory } from '../config/store';
import {
  getActiveBranchById,
  getActiveBranches,
  getActiveProvider,
} from '../providers/providerManager';

export const conflictsRouter = Router();

conflictsRouter.get('/', async (_req, res, next) => {
  try {
    const provider = getActiveProvider();
    const branches = getActiveBranches().sort((a, b) => Number(b.isMaster) - Number(a.isMaster));
    const lists = await Promise.all(
      branches.map(async (branch) => {
        const files = await provider.listConflicts(branch);
        return files.map(
          (file): ConflictListItem => ({
            branchId: branch.id,
            branchName: branch.name,
            isMaster: branch.isMaster,
            file,
          })
        );
      })
    );
    res.json(lists.flat());
  } catch (err) {
    next(err);
  }
});

conflictsRouter.get('/:branchId/detail', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const filePath = String(req.query.file ?? '');
    if (!filePath) {
      res.status(400).json({ error: 'file query parameter is required.' });
      return;
    }
    const detail = await getActiveProvider().getConflictDetail(branch, filePath);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

conflictsRouter.post('/:branchId/save-resolve', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const filePath = String(req.body?.filePath ?? '');
    const resolvedContent = String(req.body?.resolvedContent ?? '');
    if (!filePath) {
      res.status(400).json({ error: 'filePath is required.' });
      return;
    }
    const result = await getActiveProvider().saveAndResolveConflict(
      branch,
      filePath,
      resolvedContent
    );
    await appendOperationHistory({
      action: 'conflict.resolve',
      branchName: branch.name,
      details: `Saved & resolved ${filePath} on ${branch.name}`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

conflictsRouter.post('/:branchId/quick-resolve', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const filePath = String(req.body?.filePath ?? '');
    const strategy = String(req.body?.strategy ?? '') as ConflictQuickStrategy;
    const valid: ConflictQuickStrategy[] = [
      'mine-full',
      'theirs-full',
      'working',
      'mine-conflict',
      'theirs-conflict',
    ];
    if (!filePath || !valid.includes(strategy)) {
      res.status(400).json({ error: 'Valid filePath and strategy are required.' });
      return;
    }
    const result = await getActiveProvider().quickResolveConflict(branch, filePath, strategy);
    await appendOperationHistory({
      action: 'conflict.quickResolve',
      branchName: branch.name,
      details: `Resolved ${filePath} (${strategy}) on ${branch.name}`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
