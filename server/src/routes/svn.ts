import { Router } from 'express';
import { appendOperationHistory } from '../config/store';
import {
  getActiveBranchById,
  getActiveBranches,
  getActiveProvider,
} from '../providers/providerManager';

export const svnRouter = Router();

svnRouter.get('/status-all', async (req, res, next) => {
  try {
    const checkRemote = req.query.remote === 'true';
    const provider = getActiveProvider();
    const branches = getActiveBranches().sort((a, b) => Number(b.isMaster) - Number(a.isMaster));
    const statuses = await Promise.all(
      branches.map((branch) => provider.getBranchStatus(branch, checkRemote))
    );
    res.json(statuses);
  } catch (err) {
    next(err);
  }
});

svnRouter.get('/:branchId/status', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const checkRemote = req.query.remote === 'true';
    const status = await getActiveProvider().getBranchStatus(branch, checkRemote);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

svnRouter.post('/update-all', async (_req, res, next) => {
  try {
    const provider = getActiveProvider();
    const branches = getActiveBranches();
    const results = await Promise.all(
      branches.map(async (branch) => {
        try {
          const result = await provider.updateBranch(branch);
          return { branchId: branch.id, branchName: branch.name, ok: true, ...result };
        } catch (err) {
          return {
            branchId: branch.id,
            branchName: branch.name,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    await appendOperationHistory({
      action: 'svn.updateAll',
      details: `Updated ${results.filter((r) => r.ok).length}/${results.length} branches`,
      status: results.every((r) => r.ok) ? 'success' : 'error',
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

svnRouter.post('/:branchId/update', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const result = await getActiveProvider().updateBranch(branch);
    await appendOperationHistory({
      action: 'svn.update',
      branchName: branch.name,
      details: `Updated ${branch.name} to r${result.newRevision}`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

svnRouter.post('/:branchId/commit', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const files = Array.isArray(req.body?.files) ? (req.body.files as string[]) : [];
    const message = String(req.body?.message ?? '');
    const result = await getActiveProvider().commitBranch(branch, files, message);
    await appendOperationHistory({
      action: 'svn.commit',
      branchName: branch.name,
      details: `Committed ${files.length} file(s) to ${branch.name}${result.newRevision ? ` (r${result.newRevision})` : ''}`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

svnRouter.get('/:branchId/diff', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const file = typeof req.query.file === 'string' && req.query.file ? req.query.file : undefined;
    const rev =
      typeof req.query.rev === 'string' && req.query.rev ? Number(req.query.rev) : undefined;
    const diff = await getActiveProvider().getDiff(branch, file, rev);
    res.json({ diff });
  } catch (err) {
    next(err);
  }
});

svnRouter.get('/:branchId/log', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) || 30 : 30;
    const entries = await getActiveProvider().getLog(branch, limit);
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

svnRouter.post('/:branchId/revert', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const files = Array.isArray(req.body?.files) ? (req.body.files as string[]) : undefined;
    const result = await getActiveProvider().revert(branch, files);
    await appendOperationHistory({
      action: 'svn.revert',
      branchName: branch.name,
      details: files?.length
        ? `Reverted ${files.length} file(s) on ${branch.name}`
        : `Reverted all local changes on ${branch.name}`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

svnRouter.post('/:branchId/cleanup', async (req, res, next) => {
  try {
    const branch = getActiveBranchById(req.params.branchId);
    const result = await getActiveProvider().cleanup(branch);
    await appendOperationHistory({
      action: 'svn.cleanup',
      branchName: branch.name,
      details: `Ran cleanup on ${branch.name}`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
