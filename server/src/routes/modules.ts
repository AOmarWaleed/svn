import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { DiscoveredFolder } from '../../../shared/types';
import {
  addModule,
  appendOperationHistory,
  deleteModule,
  getActiveRepoRoot,
  getEnvs,
  getModules,
  getSettings,
  updateModule,
} from '../config/store';
import { ensureSampleRepoInitialized } from '../sample/sampleRcmBuilder';

export const modulesRouter = Router();

modulesRouter.get('/', (_req, res) => {
  res.json(getModules());
});

modulesRouter.post('/', async (req, res, next) => {
  try {
    const { name, category, paths } = req.body ?? {};
    if (!name || typeof name !== 'string' || !paths || typeof paths !== 'object') {
      res.status(400).json({ error: 'Module name and paths map are required.' });
      return;
    }
    const created = await addModule({ name, category, paths });
    await appendOperationHistory({
      action: 'module.add',
      details: `Added module mapping: ${created.name}`,
      status: 'success',
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

modulesRouter.put('/:id', async (req, res, next) => {
  try {
    const updated = await updateModule(req.params.id, req.body ?? {});
    await appendOperationHistory({
      action: 'module.update',
      details: `Updated module mapping: ${updated.name}`,
      status: 'success',
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

modulesRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteModule(req.params.id);
    await appendOperationHistory({
      action: 'module.delete',
      details: `Deleted module mapping: ${req.params.id}`,
      status: 'success',
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

modulesRouter.post('/discover', async (_req, res, next) => {
  try {
    if (getSettings().mode === 'sample') {
      await ensureSampleRepoInitialized();
    }
    const repoRoot = getActiveRepoRoot();
    if (!fs.existsSync(repoRoot)) {
      res.status(404).json({ error: `Repository root not found: ${repoRoot}` });
      return;
    }

    const envs = getEnvs();
    const modules = getModules();
    const mappedSet = new Set<string>();
    for (const m of modules) {
      for (const p of Object.values(m.paths)) {
        if (p) mappedSet.add(p.split('\\').join('/').toLowerCase());
      }
    }

    const discovered: DiscoveredFolder[] = [];

    for (const env of envs) {
      const envDir = env.basePath
        ? path.join(repoRoot, env.basePath.split('/').join(path.sep))
        : repoRoot;
      if (!fs.existsSync(envDir)) continue;

      const entries = await fsp.readdir(envDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'BRANCHES') continue;

        const rel = env.basePath ? `${env.basePath}/${entry.name}` : entry.name;
        const alreadyMapped = mappedSet.has(rel.toLowerCase());
        discovered.push({
          envId: env.id,
          name: entry.name,
          relativePath: rel,
          fullPath: path.join(envDir, entry.name),
          alreadyMapped,
        });
      }
    }

    res.json(discovered);
  } catch (err) {
    next(err);
  }
});
