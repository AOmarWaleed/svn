import { Router } from 'express';
import type {
  ModuleApplyPlan,
  TransferApplyResponse,
  TransferEngine,
  TransferPreviewResponse,
} from '../../../shared/types';
import {
  appendOperationHistory,
  getActiveRepoRoot,
  getEnvById,
  getModuleById,
  getSettings,
} from '../config/store';
import { executeRollbackSnapshot } from '../engines/conflictTracker';
import { applyFolderSyncBatch, previewFolderSyncBatch } from '../engines/folderSyncEngine';
import {
  applySvnMergeBatch,
  getEligibleRevisionsBatch,
  previewSvnMergeBatch,
  revertModuleEnv,
} from '../engines/svnEngine';
import { ensureSampleRepoInitialized } from '../sample/sampleRcmBuilder';

export const transferRouter = Router();

transferRouter.post('/eligible', async (req, res, next) => {
  try {
    const { sourceEnvId, targetEnvId, moduleIds } = req.body ?? {};
    if (!sourceEnvId || !targetEnvId || !Array.isArray(moduleIds)) {
      res.status(400).json({ error: 'sourceEnvId, targetEnvId, and moduleIds are required.' });
      return;
    }
    const items = await getEligibleRevisionsBatch(
      String(sourceEnvId),
      String(targetEnvId),
      moduleIds.map(String)
    );
    res.json(items);
  } catch (err) {
    next(err);
  }
});

transferRouter.post('/preview', async (req, res, next) => {
  try {
    const { engine, sourceEnvId, targetEnvId, moduleIds, ignoreAncestry, revisionsByModule } =
      req.body ?? {};

    if (!sourceEnvId || !targetEnvId || !Array.isArray(moduleIds) || moduleIds.length === 0) {
      res
        .status(400)
        .json({ error: 'sourceEnvId, targetEnvId, and at least one moduleId are required.' });
      return;
    }
    if (sourceEnvId === targetEnvId) {
      res.status(400).json({ error: 'Source and target environments must be different.' });
      return;
    }

    const chosenEngine: TransferEngine = engine === 'svn-merge' ? 'svn-merge' : 'folder-sync';
    const settings = getSettings();
    if (settings.mode === 'sample') await ensureSampleRepoInitialized();

    const sourceEnv = getEnvById(String(sourceEnvId));
    const targetEnv = getEnvById(String(targetEnvId));
    const modules = moduleIds.map((id: unknown) => getModuleById(String(id)));
    const repoRoot = getActiveRepoRoot();

    const suggestedCommitMessage = `Transfer ${modules.map((m) => m.name).join(', ')} from ${sourceEnv.label} to ${targetEnv.label}`;

    if (chosenEngine === 'folder-sync') {
      const folderModules = await previewFolderSyncBatch(
        repoRoot,
        sourceEnv,
        targetEnv,
        modules,
        settings
      );
      const response: TransferPreviewResponse = {
        engine: chosenEngine,
        sourceEnvId: sourceEnv.id,
        targetEnvId: targetEnv.id,
        dryRun: true,
        folderModules,
        suggestedCommitMessage,
      };
      res.json(response);
      return;
    }

    const svnModules = await previewSvnMergeBatch(
      sourceEnv.id,
      targetEnv.id,
      modules.map((m) => m.id),
      {
        ignoreAncestry: Boolean(ignoreAncestry),
        revisionsByModule: revisionsByModule as Record<string, number[]> | undefined,
      }
    );
    const response: TransferPreviewResponse = {
      engine: chosenEngine,
      sourceEnvId: sourceEnv.id,
      targetEnvId: targetEnv.id,
      dryRun: true,
      svnModules,
      suggestedCommitMessage,
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

transferRouter.post('/apply', async (req, res, next) => {
  try {
    const {
      engine,
      sourceEnvId,
      targetEnvId,
      moduleIds,
      modulePlans,
      ignoreAncestry,
      revisionsByModule,
    } = req.body ?? {};

    if (!sourceEnvId || !targetEnvId || !Array.isArray(moduleIds) || moduleIds.length === 0) {
      res
        .status(400)
        .json({ error: 'sourceEnvId, targetEnvId, and at least one moduleId are required.' });
      return;
    }
    if (sourceEnvId === targetEnvId) {
      res.status(400).json({ error: 'Source and target environments must be different.' });
      return;
    }

    const chosenEngine: TransferEngine = engine === 'svn-merge' ? 'svn-merge' : 'folder-sync';
    const settings = getSettings();
    if (settings.mode === 'sample') await ensureSampleRepoInitialized();

    const sourceEnv = getEnvById(String(sourceEnvId));
    const targetEnv = getEnvById(String(targetEnvId));
    const modules = moduleIds.map((id: unknown) => getModuleById(String(id)));
    const repoRoot = getActiveRepoRoot();

    const suggestedCommitMessage = `Merge ${modules.map((m) => m.name).join(', ')} from ${sourceEnv.label} into ${targetEnv.label}`;

    if (chosenEngine === 'folder-sync') {
      const plans: ModuleApplyPlan[] = Array.isArray(modulePlans) ? modulePlans : [];
      const result = await applyFolderSyncBatch(
        repoRoot,
        sourceEnv,
        targetEnv,
        modules,
        plans,
        settings
      );

      await appendOperationHistory({
        action: 'transfer.folderSync',
        details: `${sourceEnv.label} -> ${targetEnv.label}: ${modules.length} module(s), ${result.conflicts.length} conflict/diff item(s)`,
        status: 'success',
      });

      const response: TransferApplyResponse = {
        ok: true,
        engine: chosenEngine,
        rollbackId: result.rollbackId,
        appliedModules: result.appliedModules,
        conflicts: result.conflicts,
        suggestedCommitMessage,
      };
      res.json(response);
      return;
    }

    const result = await applySvnMergeBatch(
      sourceEnv.id,
      targetEnv.id,
      modules.map((m) => m.id),
      {
        ignoreAncestry: Boolean(ignoreAncestry),
        revisionsByModule: revisionsByModule as Record<string, number[]> | undefined,
      }
    );

    await appendOperationHistory({
      action: 'transfer.svnMerge',
      details: `SVN merge ${sourceEnv.label} -> ${targetEnv.label}: ${modules.length} module(s), ${result.conflicts.length} conflict(s)`,
      status: 'success',
    });

    const response: TransferApplyResponse = {
      ok: true,
      engine: chosenEngine,
      rollbackId: result.rollbackId,
      appliedModules: result.appliedModules,
      conflicts: result.conflicts,
      suggestedCommitMessage,
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

transferRouter.post('/rollback', async (req, res, next) => {
  try {
    const { rollbackId, targetEnvId, moduleIds } = req.body ?? {};
    if (rollbackId && typeof rollbackId === 'string') {
      const restored = await executeRollbackSnapshot(rollbackId);
      await appendOperationHistory({
        action: 'transfer.rollback',
        details: `Rolled back ${restored} file(s) using snapshot ${rollbackId}`,
        status: 'success',
      });
      res.json({ ok: true, restoredCount: restored });
      return;
    }

    if (targetEnvId && Array.isArray(moduleIds)) {
      for (const mId of moduleIds) {
        await revertModuleEnv(String(mId), String(targetEnvId));
      }
      await appendOperationHistory({
        action: 'transfer.rollback',
        details: `Reverted ${moduleIds.length} module(s) in ${targetEnvId}`,
        status: 'success',
      });
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Provide rollbackId or targetEnvId + moduleIds.' });
  } catch (err) {
    next(err);
  }
});
