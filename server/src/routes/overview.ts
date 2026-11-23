import { Router } from 'express';
import { appendOperationHistory } from '../config/store';
import {
  commitModuleEnv,
  getModuleDiff,
  getModuleLog,
  getRepoOverview,
  revertModuleEnv,
  updateModuleEnv,
} from '../engines/svnEngine';

export const overviewRouter = Router();

overviewRouter.get('/overview', async (_req, res, next) => {
  try {
    const overview = await getRepoOverview();
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

overviewRouter.post('/module/:moduleId/:envId/update', async (req, res, next) => {
  try {
    const { moduleId, envId } = req.params;
    const result = await updateModuleEnv(moduleId, envId);
    await appendOperationHistory({
      action: 'module.update',
      details: `Updated module ${moduleId} in ${envId}`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

overviewRouter.post('/module/:moduleId/:envId/commit', async (req, res, next) => {
  try {
    const { moduleId, envId } = req.params;
    const files = Array.isArray(req.body?.files) ? (req.body.files as string[]) : [];
    const message = String(req.body?.message ?? '');
    const result = await commitModuleEnv(moduleId, envId, files, message);
    await appendOperationHistory({
      action: 'module.commit',
      details: `Committed ${files.length} file(s) in ${moduleId} (${envId})${result.newRevision ? ` r${result.newRevision}` : ''}`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

overviewRouter.post('/module/:moduleId/:envId/revert', async (req, res, next) => {
  try {
    const { moduleId, envId } = req.params;
    const files = Array.isArray(req.body?.files) ? (req.body.files as string[]) : undefined;
    const result = await revertModuleEnv(moduleId, envId, files);
    await appendOperationHistory({
      action: 'module.revert',
      details: `Reverted changes in ${moduleId} (${envId})`,
      status: 'success',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

overviewRouter.get('/module/:moduleId/:envId/diff', async (req, res, next) => {
  try {
    const { moduleId, envId } = req.params;
    const file = typeof req.query.file === 'string' && req.query.file ? req.query.file : undefined;
    const diff = await getModuleDiff(moduleId, envId, file);
    res.json({ diff });
  } catch (err) {
    next(err);
  }
});

overviewRouter.get('/module/:moduleId/:envId/log', async (req, res, next) => {
  try {
    const { moduleId, envId } = req.params;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) || 30 : 30;
    const entries = await getModuleLog(moduleId, envId, limit);
    res.json(entries);
  } catch (err) {
    next(err);
  }
});
