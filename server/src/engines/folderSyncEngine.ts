import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  ActiveConflictItem,
  AppliedModuleSummary,
  AppSettings,
  EnvConfig,
  FolderFileAction,
  FolderFileDiffItem,
  ModuleApplyPlan,
  ModuleFolderPreview,
  ModuleMapping,
} from '../../../shared/types';
import { recordInstantCommandLog } from '../utils/commandLogger';
import { matchesAnyPattern, resolveInsideRoot, toPosixRel } from '../utils/pathSafety';
import { buildSmartConflictMarkers, computeUnifiedDiff, isBinaryBuffer } from '../utils/textDiff';
import {
  getLiveSyncConflicts,
  registerSyncConflict,
  saveRollbackSnapshot,
  type RollbackFileSnapshot,
} from './conflictTracker';

const MAX_TEXT_DIFF_BYTES = 512 * 1024; // 512 KB

interface WalkStats {
  files: string[];
  ignoredCount: number;
}

async function walkFolderFiles(
  baseDir: string,
  ignorePatterns: string[]
): Promise<WalkStats> {
  const files: string[] = [];
  let ignoredCount = 0;

  if (!fs.existsSync(baseDir)) {
    return { files, ignoredCount };
  }

  async function walk(currentDir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      const rel = toPosixRel(baseDir, full);

      if (matchesAnyPattern(rel, ignorePatterns)) {
        ignoredCount++;
        continue;
      }

      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  await walk(baseDir);
  files.sort((a, b) => a.localeCompare(b));
  return { files, ignoredCount };
}

export async function previewModuleFolderSync(
  repoRoot: string,
  sourceEnv: EnvConfig,
  targetEnv: EnvConfig,
  mod: ModuleMapping,
  settings: AppSettings
): Promise<ModuleFolderPreview> {
  const sourceRelPath = mod.paths[sourceEnv.id] ?? '';
  const targetRelPath = mod.paths[targetEnv.id] ?? '';

  const sourceFull = sourceRelPath ? resolveInsideRoot(repoRoot, sourceRelPath) : '';
  const targetFull = targetRelPath ? resolveInsideRoot(repoRoot, targetRelPath) : '';

  const sourceExists = Boolean(sourceFull && fs.existsSync(sourceFull));
  const targetExists = Boolean(targetFull && fs.existsSync(targetFull));

  const [sourceWalk, targetWalk] = await Promise.all([
    sourceExists
      ? walkFolderFiles(sourceFull, settings.ignorePatterns)
      : Promise.resolve({ files: [], ignoredCount: 0 }),
    targetExists
      ? walkFolderFiles(targetFull, settings.ignorePatterns)
      : Promise.resolve({ files: [], ignoredCount: 0 }),
  ]);

  const sourceSet = new Set(sourceWalk.files);
  const targetSet = new Set(targetWalk.files);
  const allRelPaths = Array.from(new Set([...sourceWalk.files, ...targetWalk.files])).sort((a, b) =>
    a.localeCompare(b)
  );

  let identicalCount = 0;
  const diffFiles: FolderFileDiffItem[] = [];
  const counts = { added: 0, modified: 0, targetOnly: 0, protected: 0 };

  for (const relPath of allRelPaths) {
    const inSource = sourceSet.has(relPath);
    const inTarget = targetSet.has(relPath);
    const sPath = path.join(sourceFull, relPath.split('/').join(path.sep));
    const tPath = path.join(targetFull, relPath.split('/').join(path.sep));
    const protectedReason = matchesAnyPattern(relPath, settings.protectedPatterns) ?? undefined;

    if (inSource && inTarget) {
      const [sBuf, tBuf] = await Promise.all([fsp.readFile(sPath), fsp.readFile(tPath)]);
      if (sBuf.equals(tBuf)) {
        identicalCount++;
        continue;
      }

      const binary = isBinaryBuffer(sBuf) || isBinaryBuffer(tBuf);
      const diffText =
        !binary && sBuf.length <= MAX_TEXT_DIFF_BYTES && tBuf.length <= MAX_TEXT_DIFF_BYTES
          ? computeUnifiedDiff(
              tBuf.toString('utf8'),
              sBuf.toString('utf8'),
              relPath,
              targetEnv.label,
              sourceEnv.label
            )
          : undefined;

      if (protectedReason) {
        counts.protected++;
        diffFiles.push({
          relPath,
          category: 'protected',
          isBinary: binary,
          sourcePath: sPath,
          targetPath: tPath,
          protectedReason,
          defaultAction: 'skip',
          diffText,
        });
      } else {
        counts.modified++;
        diffFiles.push({
          relPath,
          category: 'modified',
          isBinary: binary,
          sourcePath: sPath,
          targetPath: tPath,
          defaultAction: binary ? 'diff-in-vscode' : 'mark-conflict',
          diffText,
        });
      }
    } else if (inSource && !inTarget) {
      const sBuf = await fsp.readFile(sPath);
      const binary = isBinaryBuffer(sBuf);
      const diffText =
        !binary && sBuf.length <= MAX_TEXT_DIFF_BYTES
          ? computeUnifiedDiff('', sBuf.toString('utf8'), relPath, '/dev/null', sourceEnv.label)
          : undefined;

      if (protectedReason) {
        counts.protected++;
        diffFiles.push({
          relPath,
          category: 'protected',
          isBinary: binary,
          sourcePath: sPath,
          targetPath: tPath,
          protectedReason,
          defaultAction: 'skip',
          diffText,
        });
      } else {
        counts.added++;
        diffFiles.push({
          relPath,
          category: 'added',
          isBinary: binary,
          sourcePath: sPath,
          targetPath: tPath,
          defaultAction: 'copy',
          diffText,
        });
      }
    } else if (!inSource && inTarget) {
      const tBuf = await fsp.readFile(tPath);
      const binary = isBinaryBuffer(tBuf);
      if (protectedReason) {
        counts.protected++;
        diffFiles.push({
          relPath,
          category: 'protected',
          isBinary: binary,
          targetPath: tPath,
          protectedReason,
          defaultAction: 'skip',
        });
      } else {
        counts.targetOnly++;
        diffFiles.push({
          relPath,
          category: 'target_only',
          isBinary: binary,
          targetPath: tPath,
          defaultAction: 'skip',
        });
      }
    }
  }

  return {
    moduleId: mod.id,
    moduleName: mod.name,
    sourceRelPath,
    targetRelPath,
    sourceExists,
    targetExists,
    identicalCount,
    ignoredCount: sourceWalk.ignoredCount + targetWalk.ignoredCount,
    counts,
    files: diffFiles,
  };
}

export async function previewFolderSyncBatch(
  repoRoot: string,
  sourceEnv: EnvConfig,
  targetEnv: EnvConfig,
  modules: ModuleMapping[],
  settings: AppSettings
): Promise<ModuleFolderPreview[]> {
  const start = Date.now();
  const previews = await Promise.all(
    modules.map((m) => previewModuleFolderSync(repoRoot, sourceEnv, targetEnv, m, settings))
  );

  const summaryLines = previews.map(
    (p) =>
      `${p.moduleName}: +${p.counts.added} added, ~${p.counts.modified} modified, ${p.counts.targetOnly} target-only, ${p.counts.protected} protected`
  );
  recordInstantCommandLog({
    command: `folder-diff --dry-run ${sourceEnv.id} -> ${targetEnv.id} (${modules.length} module(s))`,
    status: 'success',
    output: summaryLines.join('\n') || 'No differences found.',
    durationMs: Date.now() - start,
  });

  return previews;
}

export async function applyFolderSyncBatch(
  repoRoot: string,
  sourceEnv: EnvConfig,
  targetEnv: EnvConfig,
  modules: ModuleMapping[],
  plans: ModuleApplyPlan[],
  settings: AppSettings
): Promise<{
  rollbackId: string;
  appliedModules: AppliedModuleSummary[];
  conflicts: ActiveConflictItem[];
}> {
  const start = Date.now();
  const planMap = new Map(plans.map((p) => [p.moduleId, p.fileActions]));
  const snapshots: RollbackFileSnapshot[] = [];
  const createdConflictIds: string[] = [];
  const appliedModules: AppliedModuleSummary[] = [];
  const logLines: string[] = [];

  for (const mod of modules) {
    const preview = await previewModuleFolderSync(repoRoot, sourceEnv, targetEnv, mod, settings);
    const overrides = planMap.get(mod.id) ?? {};

    const summary: AppliedModuleSummary = {
      moduleId: mod.id,
      moduleName: mod.name,
      copied: 0,
      markedConflict: 0,
      diffQueued: 0,
      deleted: 0,
      skipped: 0,
      svnConflicts: 0,
    };

    const targetBaseFull = resolveInsideRoot(repoRoot, preview.targetRelPath);
    const sourceBaseFull = resolveInsideRoot(repoRoot, preview.sourceRelPath);

    for (const file of preview.files) {
      const action: FolderFileAction = overrides[file.relPath] ?? file.defaultAction;
      const tFull = path.join(targetBaseFull, file.relPath.split('/').join(path.sep));
      const sFull = path.join(sourceBaseFull, file.relPath.split('/').join(path.sep));

      if (action === 'skip') {
        summary.skipped++;
        continue;
      }

      if (action === 'copy') {
        if (!fs.existsSync(sFull)) {
          summary.skipped++;
          continue;
        }
        const existedBefore = fs.existsSync(tFull);
        const previousContent = existedBefore ? await fsp.readFile(tFull) : undefined;
        snapshots.push({ fullPath: tFull, existedBefore, previousContent });

        await fsp.mkdir(path.dirname(tFull), { recursive: true });
        await fsp.copyFile(sFull, tFull);
        summary.copied++;
        logLines.push(`COPY   [${mod.name}] ${file.relPath}`);
        continue;
      }

      if (action === 'delete') {
        if (fs.existsSync(tFull)) {
          const previousContent = await fsp.readFile(tFull);
          snapshots.push({ fullPath: tFull, existedBefore: true, previousContent });
          await fsp.unlink(tFull);
          summary.deleted++;
          logLines.push(`DELETE [${mod.name}] ${file.relPath}`);
        }
        continue;
      }

      if (action === 'mark-conflict') {
        if (!fs.existsSync(sFull)) {
          summary.skipped++;
          continue;
        }
        if (!fs.existsSync(tFull) || file.isBinary) {
          if (file.isBinary && fs.existsSync(tFull)) {
            const conflict = registerSyncConflict({
              moduleId: mod.id,
              moduleName: mod.name,
              targetEnvId: targetEnv.id,
              sourceEnvId: sourceEnv.id,
              relPath: file.relPath,
              targetFullPath: tFull,
              sourceFullPath: sFull,
              kind: 'sync-diff',
              description: 'Binary file differs — review in VS Code or choose Source/Target.',
            });
            createdConflictIds.push(conflict.id);
            summary.diffQueued++;
          } else {
            const existedBefore = fs.existsSync(tFull);
            const previousContent = existedBefore ? await fsp.readFile(tFull) : undefined;
            snapshots.push({ fullPath: tFull, existedBefore, previousContent });
            await fsp.mkdir(path.dirname(tFull), { recursive: true });
            await fsp.copyFile(sFull, tFull);
            summary.copied++;
          }
          continue;
        }

        const [targetBuf, sourceBuf] = await Promise.all([fsp.readFile(tFull), fsp.readFile(sFull)]);
        const targetText = targetBuf.toString('utf8');
        const sourceText = sourceBuf.toString('utf8');
        const { content, conflictCount } = buildSmartConflictMarkers(
          targetText,
          sourceText,
          `${targetEnv.label} (Target)`,
          `${sourceEnv.label} (Source)`
        );

        if (conflictCount === 0) {
          summary.skipped++;
          continue;
        }

        snapshots.push({ fullPath: tFull, existedBefore: true, previousContent: targetBuf });
        await fsp.writeFile(tFull, content, 'utf8');

        const conflict = registerSyncConflict({
          moduleId: mod.id,
          moduleName: mod.name,
          targetEnvId: targetEnv.id,
          sourceEnvId: sourceEnv.id,
          relPath: file.relPath,
          targetFullPath: tFull,
          sourceFullPath: sFull,
          kind: 'sync-markers',
          preMergeTargetContent: targetBuf,
          description: `${conflictCount} conflict block(s) injected for VS Code resolution.`,
        });
        createdConflictIds.push(conflict.id);
        summary.markedConflict++;
        logLines.push(`CONFLICT(${conflictCount}) [${mod.name}] ${file.relPath}`);
        continue;
      }

      if (action === 'diff-in-vscode') {
        const conflict = registerSyncConflict({
          moduleId: mod.id,
          moduleName: mod.name,
          targetEnvId: targetEnv.id,
          sourceEnvId: sourceEnv.id,
          relPath: file.relPath,
          targetFullPath: tFull,
          sourceFullPath: sFull,
          kind: 'sync-diff',
          description: 'Queued for side-by-side comparison (code --diff) in VS Code.',
        });
        createdConflictIds.push(conflict.id);
        summary.diffQueued++;
        logLines.push(`DIFF-QUEUE [${mod.name}] ${file.relPath}`);
      }
    }

    appliedModules.push(summary);
  }

  const rollbackId = saveRollbackSnapshot(snapshots, createdConflictIds);
  const allConflicts = await getLiveSyncConflicts();

  recordInstantCommandLog({
    command: `folder-sync --apply ${sourceEnv.id} -> ${targetEnv.id} (rollback=${rollbackId})`,
    status: 'success',
    output: logLines.join('\n') || 'Transfer applied with no file modifications.',
    durationMs: Date.now() - start,
  });

  return {
    rollbackId,
    appliedModules,
    conflicts: allConflicts.filter((c) => createdConflictIds.includes(c.id)),
  };
}
