import { Router } from 'express';
import { appendOperationHistory, getSettings } from '../config/store';
import {
  addActiveBranch,
  getActiveBranches,
  removeActiveBranch,
  setActiveMasterBranch,
  updateActiveBranch,
} from '../providers/providerManager';
import { scanForSvnWorkingCopies } from '../utils/pathSafety';

export const branchesRouter = Router();

branchesRouter.get('/', (_req, res) => {
  const branches = getActiveBranches().sort((a, b) => Number(b.isMaster) - Number(a.isMaster));
  res.json(branches);
});

branchesRouter.post('/', async (req, res, next) => {
  try {
    const { name, path, isMaster, color } = req.body ?? {};
    if (!path || typeof path !== 'string') {
      res.status(400).json({ error: 'Working copy folder path is required.' });
      return;
    }
    const created = await addActiveBranch({
      name: typeof name === 'string' && name.trim() ? name : path,
      path,
      isMaster: Boolean(isMaster),
      color: typeof color === 'string' ? color : undefined,
    });
    await appendOperationHistory({
      action: 'branch.add',
      branchName: created.name,
      details: `Added branch ${created.name} (${created.path})`,
      status: 'success',
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

branchesRouter.put('/:id', async (req, res, next) => {
  try {
    const updated = await updateActiveBranch(req.params.id, req.body ?? {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

branchesRouter.delete('/:id', async (req, res, next) => {
  try {
    await removeActiveBranch(req.params.id);
    await appendOperationHistory({
      action: 'branch.remove',
      details: `Removed branch ${req.params.id}`,
      status: 'success',
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

branchesRouter.post('/:id/set-master', async (req, res, next) => {
  try {
    const branches = await setActiveMasterBranch(req.params.id);
    res.json(branches);
  } catch (err) {
    next(err);
  }
});

branchesRouter.post('/scan', async (req, res, next) => {
  try {
    const rootDir = String(req.body?.rootDir ?? '').trim();
    if (!rootDir) {
      res.status(400).json({ error: 'Root folder path is required.' });
      return;
    }

    const existingPaths = getActiveBranches().map((b) => b.path);

    if (getSettings().mode === 'demo' && rootDir.toLowerCase().includes('companysvn')) {
      const demoCandidates = [
        { name: 'erp-master', path: 'D:\\CompanySVN\\erp-master' },
        { name: 'erp-billing-v2', path: 'D:\\CompanySVN\\erp-billing-v2' },
        { name: 'erp-patient-portal', path: 'D:\\CompanySVN\\erp-patient-portal' },
        { name: 'erp-hotfix-auth', path: 'D:\\CompanySVN\\erp-hotfix-auth' },
        { name: 'erp-mobile-api', path: 'D:\\CompanySVN\\erp-mobile-api' },
      ];
      const existingSet = new Set(existingPaths.map((p) => p.toLowerCase()));
      res.json(
        demoCandidates.map((c) => ({
          ...c,
          alreadyAdded: existingSet.has(c.path.toLowerCase()),
        }))
      );
      return;
    }

    const found = await scanForSvnWorkingCopies(rootDir, existingPaths, 3);
    res.json(found);
  } catch (err) {
    next(err);
  }
});
