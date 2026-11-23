import { Router } from 'express';
import type { MergeMode } from '../../../shared/types';
import { appendOperationHistory } from '../config/store';
import { getActiveBranchById, getActiveProvider } from '../providers/providerManager';

export const mergeRouter = Router();

mergeRouter.get('/eligible', async (req, res, next) => {
  try {
    const sourceId = String(req.query.sourceId ?? '');
    const targetId = String(req.query.targetId ?? '');
    if (!sourceId || !targetId) {
      res.status(400).json({ error: 'sourceId and targetId are required.' });
      return;
    }
    const source = getActiveBranchById(sourceId);
    const target = getActiveBranchById(targetId);
    const revisions = await getActiveProvider().getEligibleRevisions(source, target);
    res.json(revisions);
  } catch (err) {
    next(err);
  }
});

mergeRouter.post('/preflight', async (req, res, next) => {
  try {
    const { sourceId, targetId } = req.body ?? {};
    if (!sourceId || !targetId) {
      res.status(400).json({ error: 'sourceId and targetId are required.' });
      return;
    }
    const source = getActiveBranchById(String(sourceId));
    const target = getActiveBranchById(String(targetId));
    const result = await getActiveProvider().preflightMerge(source, target);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

mergeRouter.post('/test', async (req, res, next) => {
  try {
    const { sourceId, targetId, mode, revisions } = req.body ?? {};
    if (!sourceId || !targetId) {
      res.status(400).json({ error: 'sourceId and targetId are required.' });
      return;
    }
    const source = getActiveBranchById(String(sourceId));
    const target = getActiveBranchById(String(targetId));
    const mergeMode: MergeMode = mode === 'revisions' ? 'revisions' : 'all';
    const revList = Array.isArray(revisions) ? revisions.map(Number).filter(Number.isFinite) : [];

    const result = await getActiveProvider().testMerge(source, target, mergeMode, revList);
    await appendOperationHistory({
      action: 'merge.test',
      branchName: source.name,
      targetBranchName: target.name,
      details: `Dry-run ${source.name} -> ${target.name}: ${result.summary.total} impacted, ${result.summary.textConflicts + result.summary.treeConflicts} predicted conflict(s)`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

mergeRouter.post('/preview-diff', async (req, res, next) => {
  try {
    const { sourceId, targetId, filePath, revisions } = req.body ?? {};
    if (!sourceId || !targetId || !filePath) {
      res.status(400).json({ error: 'sourceId, targetId, and filePath are required.' });
      return;
    }
    const source = getActiveBranchById(String(sourceId));
    const target = getActiveBranchById(String(targetId));
    const revList = Array.isArray(revisions) ? revisions.map(Number).filter(Number.isFinite) : [];
    const diff = await getActiveProvider().getMergeFileDiff(
      source,
      target,
      String(filePath),
      revList
    );
    res.json({ diff });
  } catch (err) {
    next(err);
  }
});

mergeRouter.post('/confirm', async (req, res, next) => {
  try {
    const { sourceId, targetId, mode, revisions } = req.body ?? {};
    if (!sourceId || !targetId) {
      res.status(400).json({ error: 'sourceId and targetId are required.' });
      return;
    }
    const source = getActiveBranchById(String(sourceId));
    const target = getActiveBranchById(String(targetId));
    const mergeMode: MergeMode = mode === 'revisions' ? 'revisions' : 'all';
    const revList = Array.isArray(revisions) ? revisions.map(Number).filter(Number.isFinite) : [];

    const result = await getActiveProvider().executeMerge(source, target, mergeMode, revList);
    await appendOperationHistory({
      action: 'merge.confirm',
      branchName: source.name,
      targetBranchName: target.name,
      details: result.hasConflicts
        ? `Merged ${source.name} -> ${target.name} with ${result.conflictedFiles.length} conflict(s)`
        : `Cleanly merged ${source.name} -> ${target.name} (${result.summary.total} files)`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

mergeRouter.post('/rollback', async (req, res, next) => {
  try {
    const { targetId } = req.body ?? {};
    if (!targetId) {
      res.status(400).json({ error: 'targetId is required.' });
      return;
    }
    const target = getActiveBranchById(String(targetId));
    const result = await getActiveProvider().revert(target);
    await appendOperationHistory({
      action: 'merge.rollback',
      targetBranchName: target.name,
      details: `Rolled back local merge changes on ${target.name}`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
