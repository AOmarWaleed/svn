import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ActiveConflictItem,
  AppliedModuleSummary,
  EnvModuleStatus,
  LogEntry,
  ModuleEligibleInfo,
  ModuleMapping,
  ModuleOverviewRow,
  ModuleSvnMergePreview,
  RepoOverview,
  ScannedSvnFile,
  SvnMergeImpactItem,
} from '../../../shared/types';
import {
  getActiveRepoRoot,
  getEnvById,
  getEnvs,
  getModuleById,
  getModules,
  getSettings,
} from '../config/store';
import {
  commitSampleModuleFiles,
  ensureSampleRepoInitialized,
  getSampleBaselineBuffer,
  getSampleLogsForModule,
  getSampleModuleSvnStatus,
  getSampleRepoMeta,
  revertSampleModuleFiles,
} from '../sample/sampleRcmBuilder';
import {
  appendCommandOutput,
  finishCommandLog,
  formatCommandLine,
  recordInstantCommandLog,
  startCommandLog,
} from '../utils/commandLogger';
import { matchesAnyPattern, resolveInsideRoot } from '../utils/pathSafety';
import {
  parseMergeinfoEligible,
  parseMergeOutput,
  parseSvnInfoXml,
  parseSvnLogXml,
  parseSvnStatusXml,
} from '../utils/svnParsers';
import {
  buildSmartConflictMarkers,
  computeUnifiedDiff,
  countConflictMarkers,
  isBinaryBuffer,
} from '../utils/textDiff';
import {
  clearTrackedConflictsForModule,
  findTrackedConflictById,
  getLiveSyncConflicts,
  registerSyncConflict,
  removeTrackedConflictById,
  saveRollbackSnapshot,
  type RollbackFileSnapshot,
} from './conflictTracker';
import { previewModuleFolderSync } from './folderSyncEngine';

interface ExecOptions {
  cwd?: string;
  moduleId?: string;
  moduleName?: string;
  network?: boolean;
  quiet?: boolean;
}

function encodeSvnSubpath(repoUrl: string, relPath: string): string {
  const clean = relPath.split('\\').join('/').replace(/^\/+|\/+$/g, '');
  if (!clean) return repoUrl.replace(/\/+$/, '');
  const encoded = clean
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  return `${repoUrl.replace(/\/+$/, '')}/${encoded}`;
}

async function execSvn(
  args: string[],
  opts: ExecOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const settings = getSettings();
  const svnExe = settings.svnPath || 'svn';

  const finalArgs = [...args, '--non-interactive'];
  if (opts.network) {
    if (settings.trustServerCert) {
      finalArgs.push(
        '--trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other'
      );
    }
    if (settings.authMode === 'custom' && settings.username) {
      finalArgs.push('--username', settings.username);
      if (settings.password) {
        finalArgs.push('--password', settings.password);
      }
    }
  }

  const commandStr = formatCommandLine(svnExe, finalArgs);
  const startTime = Date.now();
  const logId = opts.quiet
    ? null
    : startCommandLog({
        moduleId: opts.moduleId,
        moduleName: opts.moduleName,
        command: commandStr,
      });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(svnExe, finalArgs, {
        cwd: opts.cwd,
        windowsHide: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (logId) finishCommandLog(logId, 'error', Date.now() - startTime, msg);
      reject(Object.assign(new Error(`Failed to start SVN: ${msg}`), { statusCode: 500 }));
      return;
    }

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (logId && !args.includes('--xml')) appendCommandOutput(logId, text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (logId) appendCommandOutput(logId, text);
    });
    child.on('error', (err) => {
      if (logId) finishCommandLog(logId, 'error', Date.now() - startTime, err.message);
      reject(
        Object.assign(new Error(`SVN execution error (${svnExe}): ${err.message}`), {
          statusCode: 500,
        })
      );
    });
    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      if (code === 0) {
        if (logId) {
          finishCommandLog(
            logId,
            'success',
            duration,
            args.includes('--xml') ? `XML response (${stdout.length} bytes)` : undefined
          );
        }
        resolve({ stdout, stderr });
      } else {
        const msg = stderr.trim() || stdout.trim() || `svn exited with code ${code}`;
        if (logId) finishCommandLog(logId, 'error', duration, msg);
        reject(Object.assign(new Error(msg), { statusCode: 400 }));
      }
    });
  });
}

function summarizeScannedFiles(
  envId: string,
  relPath: string,
  fullPath: string,
  exists: boolean,
  files: ScannedSvnFile[],
  syncConflictPaths: Set<string>,
  error?: string
): EnvModuleStatus {
  let modifiedCount = 0;
  let addedCount = 0;
  let deletedCount = 0;
  let untrackedCount = 0;
  let conflictCount = 0;

  const mergedFiles = files.map((f) => {
    const isTrackedConflict = syncConflictPaths.has(f.path.toLowerCase());
    if (isTrackedConflict && f.status !== 'conflicted') {
      return { ...f, status: 'conflicted' as const };
    }
    return f;
  });

  for (const f of mergedFiles) {
    if (f.status === 'conflicted' || f.treeConflict) conflictCount++;
    else if (f.status === 'modified' || f.status === 'replaced') modifiedCount++;
    else if (f.status === 'added') addedCount++;
    else if (f.status === 'deleted' || f.status === 'missing') deletedCount++;
    else if (f.status === 'unversioned') untrackedCount++;
  }

  return {
    envId,
    relativePath: relPath,
    fullPath,
    exists,
    modifiedCount,
    addedCount,
    deletedCount,
    untrackedCount,
    conflictCount,
    isClean:
      exists &&
      modifiedCount === 0 &&
      addedCount === 0 &&
      deletedCount === 0 &&
      untrackedCount === 0 &&
      conflictCount === 0,
    files: mergedFiles,
    error,
  };
}

export async function getRepoOverview(): Promise<RepoOverview> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const envs = getEnvs();
  const modules = getModules();
  const syncConflicts = await getLiveSyncConflicts();

  if (settings.mode === 'sample') {
    await ensureSampleRepoInitialized();
  }

  let repoUrl = '';
  let revision = 0;
  let lastChangedAuthor = '';
  let lastChangedDate = '';

  if (settings.mode === 'sample') {
    const meta = getSampleRepoMeta();
    repoUrl = meta.url;
    revision = meta.revision;
    lastChangedAuthor = meta.lastChangedAuthor;
    lastChangedDate = meta.lastChangedDate;
  } else if (fs.existsSync(repoRoot)) {
    try {
      const infoRes = await execSvn(['info', '--xml'], { cwd: repoRoot, quiet: true });
      const info = parseSvnInfoXml(infoRes.stdout);
      repoUrl = info.url;
      revision = info.revision;
      lastChangedAuthor = info.lastChangedAuthor;
      lastChangedDate = info.lastChangedDate;
    } catch {
      repoUrl = repoRoot;
    }
  }

  const rows: ModuleOverviewRow[] = await Promise.all(
    modules.map(async (mod) => {
      const envMap: Record<string, EnvModuleStatus> = {};

      await Promise.all(
        envs.map(async (env) => {
          const relPath = mod.paths[env.id] ?? '';
          const fullPath = relPath ? resolveInsideRoot(repoRoot, relPath) : '';
          const exists = Boolean(fullPath && fs.existsSync(fullPath));

          const modSyncConflicts = new Set(
            syncConflicts
              .filter((c) => c.targetEnvId === env.id && c.moduleId === mod.id)
              .map((c) => c.relPath.toLowerCase())
          );

          if (!exists) {
            envMap[env.id] = summarizeScannedFiles(
              env.id,
              relPath,
              fullPath,
              false,
              [],
              modSyncConflicts
            );
            return;
          }

          try {
            const files =
              settings.mode === 'sample'
                ? await getSampleModuleSvnStatus(relPath)
                : parseSvnStatusXml(
                    (await execSvn(['status', '--xml'], { cwd: fullPath, quiet: true })).stdout,
                    fullPath
                  );
            envMap[env.id] = summarizeScannedFiles(
              env.id,
              relPath,
              fullPath,
              true,
              files,
              modSyncConflicts
            );
          } catch (err) {
            envMap[env.id] = summarizeScannedFiles(
              env.id,
              relPath,
              fullPath,
              true,
              [],
              modSyncConflicts,
              err instanceof Error ? err.message : String(err)
            );
          }
        })
      );

      return { module: mod, envs: envMap };
    })
  );

  const allConflicts = await getAllActiveConflicts();

  return {
    mode: settings.mode,
    activeRepoRoot: repoRoot,
    repoUrl,
    revision,
    lastChangedAuthor,
    lastChangedDate,
    envs,
    rows,
    totalConflicts: allConflicts.length,
  };
}

export async function updateModuleEnv(
  moduleId: string,
  envId: string
): Promise<{ output: string }> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const mod = getModuleById(moduleId);
  const env = getEnvById(envId);
  const relPath = mod.paths[env.id];
  if (!relPath) {
    throw Object.assign(new Error(`No path mapped for ${mod.name} in ${env.label}`), {
      statusCode: 400,
    });
  }
  const fullPath = resolveInsideRoot(repoRoot, relPath);

  if (settings.mode === 'sample') {
    await ensureSampleRepoInitialized();
    const meta = getSampleRepoMeta();
    const output = `Updating '${fullPath}':\nAt revision ${meta.revision}.`;
    recordInstantCommandLog({
      moduleId: mod.id,
      moduleName: `${mod.name} (${env.label})`,
      command: `svn update --accept postpone "${fullPath}"`,
      status: 'success',
      output,
      durationMs: 140,
    });
    return { output };
  }

  const { stdout } = await execSvn(['update', '--accept', 'postpone'], {
    cwd: fullPath,
    moduleId: mod.id,
    moduleName: `${mod.name} (${env.label})`,
    network: true,
  });
  return { output: stdout.trim() };
}

export async function commitModuleEnv(
  moduleId: string,
  envId: string,
  files: string[],
  message: string
): Promise<{ output: string; newRevision?: number }> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const mod = getModuleById(moduleId);
  const env = getEnvById(envId);
  const relPath = mod.paths[env.id];
  if (!relPath) {
    throw Object.assign(new Error(`No path mapped for ${mod.name} in ${env.label}`), {
      statusCode: 400,
    });
  }
  if (!message.trim()) {
    throw Object.assign(new Error('Commit message is required.'), { statusCode: 400 });
  }
  if (!files.length) {
    throw Object.assign(new Error('Select at least one file to commit.'), { statusCode: 400 });
  }

  const fullPath = resolveInsideRoot(repoRoot, relPath);
  for (const f of files) resolveInsideRoot(fullPath, f);

  if (settings.mode === 'sample') {
    await ensureSampleRepoInitialized();
    const statusFiles = await getSampleModuleSvnStatus(relPath);
    const hasConflict = statusFiles.some(
      (sf) => files.includes(sf.path) && (sf.status === 'conflicted' || sf.treeConflict)
    );
    if (hasConflict) {
      throw Object.assign(
        new Error('Cannot commit files with unresolved conflict markers.'),
        { statusCode: 409 }
      );
    }

    const newRev = await commitSampleModuleFiles(relPath, files, message.trim());
    clearTrackedConflictsForModule(env.id, mod.id);
    const output = [
      ...files.map((f) => `Sending        ${f}`),
      'Transmitting file data ...done',
      `Committed revision ${newRev}.`,
    ].join('\n');

    recordInstantCommandLog({
      moduleId: mod.id,
      moduleName: `${mod.name} (${env.label})`,
      command: `svn commit -m "${message.trim()}" ${files.join(' ')}`,
      status: 'success',
      output,
      durationMs: 210,
    });

    return { output, newRevision: newRev };
  }

  // Real SVN: add selected unversioned files first, then commit ONLY selected files
  const stRes = await execSvn(['status', '--xml'], { cwd: fullPath, quiet: true });
  const wcFiles = parseSvnStatusXml(stRes.stdout, fullPath);
  const unversionedSet = new Set(
    wcFiles.filter((f) => f.status === 'unversioned').map((f) => f.path)
  );
  const toAdd = files.filter((f) => unversionedSet.has(f));
  if (toAdd.length > 0) {
    await execSvn(['add', '--parents', ...toAdd], {
      cwd: fullPath,
      moduleId: mod.id,
      moduleName: `${mod.name} (${env.label})`,
    });
  }

  const tmpMsgFile = path.join(
    os.tmpdir(),
    `rcm-svn-msg-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );
  try {
    await fsp.writeFile(tmpMsgFile, message.trim(), 'utf8');
    const { stdout } = await execSvn(
      ['commit', '-F', tmpMsgFile, '--encoding', 'utf-8', ...files],
      {
        cwd: fullPath,
        moduleId: mod.id,
        moduleName: `${mod.name} (${env.label})`,
        network: true,
      }
    );
    clearTrackedConflictsForModule(env.id, mod.id);
    const revMatch = /Committed revision (\d+)\./i.exec(stdout);
    return {
      output: stdout.trim(),
      newRevision: revMatch ? Number(revMatch[1]) : undefined,
    };
  } finally {
    await fsp.unlink(tmpMsgFile).catch(() => undefined);
  }
}

export async function revertModuleEnv(
  moduleId: string,
  envId: string,
  files?: string[]
): Promise<{ output: string }> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const mod = getModuleById(moduleId);
  const env = getEnvById(envId);
  const relPath = mod.paths[env.id];
  if (!relPath) {
    throw Object.assign(new Error(`No path mapped for ${mod.name} in ${env.label}`), {
      statusCode: 400,
    });
  }
  const fullPath = resolveInsideRoot(repoRoot, relPath);

  if (settings.mode === 'sample') {
    const reverted = await revertSampleModuleFiles(relPath, files);
    if (!files || files.length === 0) {
      clearTrackedConflictsForModule(env.id, mod.id);
    }
    const output =
      reverted.length > 0
        ? reverted.map((f) => `Reverted '${f}'`).join('\n')
        : 'Module working copy is already clean.';
    recordInstantCommandLog({
      moduleId: mod.id,
      moduleName: `${mod.name} (${env.label})`,
      command: files?.length ? `svn revert ${files.join(' ')}` : `svn revert -R "${fullPath}"`,
      status: 'success',
      output,
      durationMs: 110,
    });
    return { output };
  }

  const targets =
    files && files.length > 0
      ? files.map((f) => {
          resolveInsideRoot(fullPath, f);
          return f;
        })
      : ['.'];
  const args = files && files.length > 0 ? ['revert', ...targets] : ['revert', '-R', '.'];
  const { stdout } = await execSvn(args, {
    cwd: fullPath,
    moduleId: mod.id,
    moduleName: `${mod.name} (${env.label})`,
  });
  if (!files || files.length === 0) {
    clearTrackedConflictsForModule(env.id, mod.id);
  }
  return { output: stdout.trim() || 'Reverted module changes.' };
}

export async function getModuleDiff(
  moduleId: string,
  envId: string,
  file?: string
): Promise<string> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const mod = getModuleById(moduleId);
  const env = getEnvById(envId);
  const relPath = mod.paths[env.id];
  if (!relPath) return '';
  const fullPath = resolveInsideRoot(repoRoot, relPath);

  if (settings.mode === 'sample') {
    await ensureSampleRepoInitialized();
    const status = await getSampleModuleSvnStatus(relPath);
    const targetFiles = file ? status.filter((f) => f.path === file) : status;
    const parts: string[] = [];

    for (const f of targetFiles) {
      const fFull = resolveInsideRoot(fullPath, f.path);
      const baseBuf = getSampleBaselineBuffer(relPath, f.path);
      const curBuf = fs.existsSync(fFull) ? await fsp.readFile(fFull) : Buffer.alloc(0);
      if (isBinaryBuffer(curBuf) || (baseBuf && isBinaryBuffer(baseBuf))) continue;
      const diff = computeUnifiedDiff(
        baseBuf ? baseBuf.toString('utf8') : '',
        curBuf.toString('utf8'),
        f.path,
        'base',
        'working copy'
      );
      if (diff) parts.push(diff);
    }
    return parts.join('\n\n');
  }

  const args = ['diff'];
  if (file) {
    resolveInsideRoot(fullPath, file);
    args.push(file);
  }
  const { stdout } = await execSvn(args, { cwd: fullPath, quiet: true });
  return stdout;
}

export async function getModuleLog(
  moduleId: string,
  envId: string,
  limit = 30
): Promise<LogEntry[]> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const mod = getModuleById(moduleId);
  const env = getEnvById(envId);
  const relPath = mod.paths[env.id];
  if (!relPath) return [];
  const fullPath = resolveInsideRoot(repoRoot, relPath);

  if (settings.mode === 'sample') {
    await ensureSampleRepoInitialized();
    return getSampleLogsForModule(relPath, limit);
  }

  const { stdout } = await execSvn(
    ['log', '--xml', '-v', '-l', String(Math.max(1, Math.min(limit, 100)))],
    {
      cwd: fullPath,
      network: true,
      quiet: true,
    }
  );
  return parseSvnLogXml(stdout);
}

export async function getEligibleRevisionsBatch(
  sourceEnvId: string,
  targetEnvId: string,
  moduleIds: string[]
): Promise<ModuleEligibleInfo[]> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const sourceEnv = getEnvById(sourceEnvId);
  const targetEnv = getEnvById(targetEnvId);

  if (settings.mode === 'sample') {
    await ensureSampleRepoInitialized();
    return moduleIds.map((id) => {
      const mod = getModuleById(id);
      const srcRel = mod.paths[sourceEnv.id] ?? '';
      return {
        moduleId: mod.id,
        moduleName: mod.name,
        revisions: srcRel ? getSampleLogsForModule(srcRel, 15) : [],
      };
    });
  }

  const rootInfo = parseSvnInfoXml(
    (await execSvn(['info', '--xml'], { cwd: repoRoot, quiet: true })).stdout
  );

  return Promise.all(
    moduleIds.map(async (id): Promise<ModuleEligibleInfo> => {
      const mod = getModuleById(id);
      const srcRel = mod.paths[sourceEnv.id] ?? '';
      const tgtRel = mod.paths[targetEnv.id] ?? '';
      if (!srcRel || !tgtRel) {
        return {
          moduleId: mod.id,
          moduleName: mod.name,
          revisions: [],
          ancestryWarning: 'Missing module path mapping in source or target environment.',
        };
      }

      const sourceUrl = encodeSvnSubpath(rootInfo.url, srcRel);
      const targetFull = resolveInsideRoot(repoRoot, tgtRel);

      try {
        const { stdout } = await execSvn(
          ['mergeinfo', '--show-revs', 'eligible', sourceUrl, targetFull],
          { cwd: targetFull, network: true, quiet: true }
        );
        const revs = parseMergeinfoEligible(stdout);
        if (revs.length === 0) {
          return { moduleId: mod.id, moduleName: mod.name, revisions: [] };
        }
        const revSet = new Set(revs);
        const { stdout: logXml } = await execSvn(
          ['log', '--xml', '-v', '-r', `${revs[revs.length - 1]}:${revs[0]}`, sourceUrl],
          { cwd: targetFull, network: true, quiet: true }
        );
        return {
          moduleId: mod.id,
          moduleName: mod.name,
          revisions: parseSvnLogXml(logXml).filter((r) => revSet.has(r.revision)),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          moduleId: mod.id,
          moduleName: mod.name,
          revisions: [],
          ancestryWarning: msg,
        };
      }
    })
  );
}

function summarizeSvnImpacts(impacts: SvnMergeImpactItem[]): ModuleSvnMergePreview['summary'] {
  const summary = {
    total: impacts.length,
    updated: 0,
    added: 0,
    deleted: 0,
    merged: 0,
    textConflicts: 0,
    treeConflicts: 0,
    protectedHits: 0,
  };
  for (const imp of impacts) {
    if (imp.treeConflict) summary.treeConflicts++;
    if (imp.fileAction === 'C' || imp.propAction === 'C') summary.textConflicts++;
    if (imp.fileAction === 'U') summary.updated++;
    else if (imp.fileAction === 'A' || imp.fileAction === 'R') summary.added++;
    else if (imp.fileAction === 'D') summary.deleted++;
    else if (imp.fileAction === 'G') summary.merged++;
    if (imp.isProtected) summary.protectedHits++;
  }
  return summary;
}

export async function previewSvnMergeBatch(
  sourceEnvId: string,
  targetEnvId: string,
  moduleIds: string[],
  opts: {
    ignoreAncestry?: boolean;
    revisionsByModule?: Record<string, number[]>;
  } = {}
): Promise<ModuleSvnMergePreview[]> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const sourceEnv = getEnvById(sourceEnvId);
  const targetEnv = getEnvById(targetEnvId);

  if (settings.mode === 'sample') {
    await ensureSampleRepoInitialized();
    const results: ModuleSvnMergePreview[] = [];
    for (const id of moduleIds) {
      const mod = getModuleById(id);
      const folderPrev = await previewModuleFolderSync(repoRoot, sourceEnv, targetEnv, mod, settings);
      const impacts: SvnMergeImpactItem[] = folderPrev.files
        .filter((f) => f.category !== 'target_only')
        .map((f) => {
          const isProtected = f.category === 'protected';
          const isConflict = f.category === 'modified' && !f.isBinary && !isProtected;
          const fileAction = f.category === 'added' ? 'A' : isConflict ? 'C' : 'U';
          return {
            path: f.relPath,
            fileAction,
            propAction: '',
            treeConflict: false,
            isConflict,
            isProtected,
            rawLine: `${fileAction}    ${f.relPath}`,
          };
        });

      const summary = summarizeSvnImpacts(impacts);
      const revs = (opts.revisionsByModule?.[mod.id] ?? []).sort((a, b) => a - b);
      const rawOutput = [
        `--- Merging (dry-run) ${folderPrev.sourceRelPath} into '${folderPrev.targetRelPath}':`,
        ...impacts.map((i) => i.rawLine),
        ...(summary.textConflicts > 0
          ? ['Summary of conflicts:', `  Text conflicts: ${summary.textConflicts}`]
          : []),
      ].join('\n');

      recordInstantCommandLog({
        moduleId: mod.id,
        moduleName: mod.name,
        command: `svn merge --dry-run --accept postpone ${opts.ignoreAncestry ? '--ignore-ancestry ' : ''}"^/${folderPrev.sourceRelPath}" "${folderPrev.targetRelPath}"`,
        status: 'success',
        output: rawOutput,
        durationMs: 180,
      });

      results.push({
        moduleId: mod.id,
        moduleName: mod.name,
        sourceRelPath: folderPrev.sourceRelPath,
        targetRelPath: folderPrev.targetRelPath,
        revisions: revs,
        impacts,
        summary,
        rawOutput,
      });
    }
    return results;
  }

  const rootInfo = parseSvnInfoXml(
    (await execSvn(['info', '--xml'], { cwd: repoRoot, quiet: true })).stdout
  );

  const results: ModuleSvnMergePreview[] = [];
  for (const id of moduleIds) {
    const mod = getModuleById(id);
    const srcRel = mod.paths[sourceEnv.id] ?? '';
    const tgtRel = mod.paths[targetEnv.id] ?? '';
    const sourceUrl = encodeSvnSubpath(rootInfo.url, srcRel);
    const targetFull = resolveInsideRoot(repoRoot, tgtRel);
    const revs = (opts.revisionsByModule?.[mod.id] ?? []).sort((a, b) => a - b);

    const args = ['merge', '--dry-run', '--accept', 'postpone'];
    if (opts.ignoreAncestry) args.push('--ignore-ancestry');
    if (revs.length > 0) args.push('-c', revs.join(','));
    args.push(sourceUrl);

    try {
      const { stdout, stderr } = await execSvn(args, {
        cwd: targetFull,
        moduleId: mod.id,
        moduleName: mod.name,
        network: true,
      });
      const combined = [stdout, stderr].filter(Boolean).join('\n');
      const impacts = parseMergeOutput(combined, targetFull).map((imp) => ({
        ...imp,
        isProtected: Boolean(matchesAnyPattern(imp.path, settings.protectedPatterns)),
      }));
      results.push({
        moduleId: mod.id,
        moduleName: mod.name,
        sourceRelPath: srcRel,
        targetRelPath: tgtRel,
        revisions: revs,
        impacts,
        summary: summarizeSvnImpacts(impacts),
        rawOutput: combined.trim(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        moduleId: mod.id,
        moduleName: mod.name,
        sourceRelPath: srcRel,
        targetRelPath: tgtRel,
        ancestryWarning: msg,
        revisions: revs,
        impacts: [],
        summary: summarizeSvnImpacts([]),
        rawOutput: msg,
      });
    }
  }

  return results;
}

export async function applySvnMergeBatch(
  sourceEnvId: string,
  targetEnvId: string,
  moduleIds: string[],
  opts: {
    ignoreAncestry?: boolean;
    revisionsByModule?: Record<string, number[]>;
  } = {}
): Promise<{
  rollbackId?: string;
  appliedModules: AppliedModuleSummary[];
  conflicts: ActiveConflictItem[];
}> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const sourceEnv = getEnvById(sourceEnvId);
  const targetEnv = getEnvById(targetEnvId);

  if (settings.mode === 'sample') {
    await ensureSampleRepoInitialized();
    const snapshots: RollbackFileSnapshot[] = [];
    const createdConflictIds: string[] = [];
    const appliedModules: AppliedModuleSummary[] = [];

    for (const id of moduleIds) {
      const mod = getModuleById(id);
      const folderPrev = await previewModuleFolderSync(repoRoot, sourceEnv, targetEnv, mod, settings);
      const sourceBaseFull = resolveInsideRoot(repoRoot, folderPrev.sourceRelPath);
      const targetBaseFull = resolveInsideRoot(repoRoot, folderPrev.targetRelPath);

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
      const lines: string[] = [];

      for (const file of folderPrev.files) {
        if (file.category === 'target_only' || file.category === 'protected') {
          summary.skipped++;
          continue;
        }

        const sFull = path.join(sourceBaseFull, file.relPath.split('/').join(path.sep));
        const tFull = path.join(targetBaseFull, file.relPath.split('/').join(path.sep));

        if (file.category === 'added') {
          const existedBefore = fs.existsSync(tFull);
          const previousContent = existedBefore ? await fsp.readFile(tFull) : undefined;
          snapshots.push({ fullPath: tFull, existedBefore, previousContent });
          await fsp.mkdir(path.dirname(tFull), { recursive: true });
          await fsp.copyFile(sFull, tFull);
          summary.copied++;
          lines.push(`A    ${file.relPath}`);
        } else if (file.category === 'modified' && !file.isBinary) {
          const [tBuf, sBuf] = await Promise.all([fsp.readFile(tFull), fsp.readFile(sFull)]);
          const { content, conflictCount } = buildSmartConflictMarkers(
            tBuf.toString('utf8'),
            sBuf.toString('utf8'),
            `${targetEnv.label} (.working)`,
            `${sourceEnv.label} (.merge-right)`
          );
          if (conflictCount > 0) {
            snapshots.push({ fullPath: tFull, existedBefore: true, previousContent: tBuf });
            await fsp.writeFile(tFull, content, 'utf8');
            const c = registerSyncConflict({
              moduleId: mod.id,
              moduleName: mod.name,
              targetEnvId: targetEnv.id,
              sourceEnvId: sourceEnv.id,
              relPath: file.relPath,
              targetFullPath: tFull,
              sourceFullPath: sFull,
              kind: 'sync-markers',
              preMergeTargetContent: tBuf,
              description: `SVN merge conflict (${conflictCount} block(s)) — open in VS Code to resolve.`,
            });
            createdConflictIds.push(c.id);
            summary.svnConflicts++;
            lines.push(`C    ${file.relPath}`);
          }
        }
      }

      recordInstantCommandLog({
        moduleId: mod.id,
        moduleName: mod.name,
        command: `svn merge --accept postpone ${opts.ignoreAncestry ? '--ignore-ancestry ' : ''}"^/${folderPrev.sourceRelPath}" "${folderPrev.targetRelPath}"`,
        status: 'success',
        output: lines.join('\n') || 'No changes merged.',
        durationMs: 250,
      });

      appliedModules.push(summary);
    }

    const rollbackId = saveRollbackSnapshot(snapshots, createdConflictIds);
    const conflicts = await getAllActiveConflicts();
    return { rollbackId, appliedModules, conflicts };
  }

  // Real SVN merge
  const rootInfo = parseSvnInfoXml(
    (await execSvn(['info', '--xml'], { cwd: repoRoot, quiet: true })).stdout
  );
  const appliedModules: AppliedModuleSummary[] = [];

  for (const id of moduleIds) {
    const mod = getModuleById(id);
    const srcRel = mod.paths[sourceEnv.id] ?? '';
    const tgtRel = mod.paths[targetEnv.id] ?? '';
    const sourceUrl = encodeSvnSubpath(rootInfo.url, srcRel);
    const targetFull = resolveInsideRoot(repoRoot, tgtRel);
    const revs = (opts.revisionsByModule?.[mod.id] ?? []).sort((a, b) => a - b);

    const args = ['merge', '--accept', 'postpone'];
    if (opts.ignoreAncestry) args.push('--ignore-ancestry');
    if (revs.length > 0) args.push('-c', revs.join(','));
    args.push(sourceUrl);

    const { stdout, stderr } = await execSvn(args, {
      cwd: targetFull,
      moduleId: mod.id,
      moduleName: mod.name,
      network: true,
    });
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    const impacts = parseMergeOutput(combined, targetFull);
    const stRes = await execSvn(['status', '--xml'], { cwd: targetFull, quiet: true });
    const wcFiles = parseSvnStatusXml(stRes.stdout, targetFull);
    const conflictedCount = wcFiles.filter(
      (f) => f.status === 'conflicted' || f.treeConflict
    ).length;

    appliedModules.push({
      moduleId: mod.id,
      moduleName: mod.name,
      copied: impacts.filter((i) => i.fileAction === 'U' || i.fileAction === 'A' || i.fileAction === 'G').length,
      markedConflict: 0,
      diffQueued: 0,
      deleted: impacts.filter((i) => i.fileAction === 'D').length,
      skipped: 0,
      svnConflicts: conflictedCount,
    });
  }

  const conflicts = await getAllActiveConflicts();
  return { appliedModules, conflicts };
}

export async function getAllActiveConflicts(): Promise<ActiveConflictItem[]> {
  const settings = getSettings();
  const repoRoot = getActiveRepoRoot();
  const envs = getEnvs();
  const modules = getModules();

  const liveSync = await getLiveSyncConflicts();
  const seenPaths = new Set(
    liveSync.map((c) =>
      process.platform === 'win32' ? c.targetFullPath.toLowerCase() : c.targetFullPath
    )
  );

  const combined: ActiveConflictItem[] = [...liveSync];

  for (const mod of modules) {
    for (const env of envs) {
      const relPath = mod.paths[env.id] ?? '';
      if (!relPath) continue;
      const fullPath = resolveInsideRoot(repoRoot, relPath);
      if (!fs.existsSync(fullPath)) continue;

      let files: ScannedSvnFile[] = [];
      try {
        files =
          settings.mode === 'sample'
            ? await getSampleModuleSvnStatus(relPath)
            : parseSvnStatusXml(
                (await execSvn(['status', '--xml'], { cwd: fullPath, quiet: true })).stdout,
                fullPath
              );
      } catch {
        continue;
      }

      for (const f of files) {
        if (f.status !== 'conflicted' && !f.treeConflict) continue;
        const targetFileFull = resolveInsideRoot(fullPath, f.path);
        const cmpKey =
          process.platform === 'win32' ? targetFileFull.toLowerCase() : targetFileFull;
        if (seenPaths.has(cmpKey)) continue;
        seenPaths.add(cmpKey);

        let markerCount = 0;
        let description: string | undefined;
        if (fs.existsSync(targetFileFull)) {
          try {
            const buf = await fsp.readFile(targetFileFull);
            if (!isBinaryBuffer(buf)) {
              markerCount = countConflictMarkers(buf.toString('utf8'));
            }
          } catch {
            // ignore
          }
        }

        if (f.treeConflict && settings.mode === 'real') {
          try {
            const infoXml = (
              await execSvn(['info', '--xml', f.path], { cwd: fullPath, quiet: true })
            ).stdout;
            description = parseSvnInfoXml(infoXml).treeConflictDescription;
          } catch {
            // ignore
          }
        }

        combined.push({
          id: `svn::${env.id}::${mod.id}::${f.path}`,
          moduleId: mod.id,
          moduleName: mod.name,
          targetEnvId: env.id,
          relPath: f.path,
          targetFullPath: targetFileFull,
          kind: f.treeConflict ? 'svn-tree' : 'svn-text',
          markerCount,
          readyToResolve: f.treeConflict ? true : markerCount === 0,
          description:
            description ??
            (f.treeConflict
              ? 'Tree conflict — open folder or accept local/incoming.'
              : markerCount > 0
                ? `${markerCount} conflict block(s) remaining.`
                : 'Markers cleared — ready to mark resolved.'),
        });
      }
    }
  }

  return combined;
}

export async function resolveConflictItem(
  conflictId: string,
  strategy: 'working' | 'source' | 'target'
): Promise<{ output: string }> {
  const settings = getSettings();
  const all = await getAllActiveConflicts();
  const conflict = all.find((c) => c.id === conflictId);
  if (!conflict) {
    throw Object.assign(new Error(`Conflict item not found: ${conflictId}`), { statusCode: 404 });
  }

  const mod = getModuleById(conflict.moduleId);
  const env = getEnvById(conflict.targetEnvId);
  const repoRoot = getActiveRepoRoot();
  const moduleFull = resolveInsideRoot(repoRoot, mod.paths[env.id] ?? '');

  const tracked = findTrackedConflictById(conflictId);

  if (strategy === 'working') {
    if (fs.existsSync(conflict.targetFullPath)) {
      const buf = await fsp.readFile(conflict.targetFullPath);
      if (!isBinaryBuffer(buf)) {
        const markers = countConflictMarkers(buf.toString('utf8'));
        if (markers > 0) {
          throw Object.assign(
            new Error(
              `File still has ${markers} unresolved <<<<<<< conflict marker(s). Save your fix in VS Code first!`
            ),
            { statusCode: 400 }
          );
        }
      }
    }

    if (tracked) removeTrackedConflictById(tracked.id);

    if (settings.mode === 'real' && (conflict.kind === 'svn-text' || conflict.kind === 'svn-tree')) {
      const { stdout } = await execSvn(['resolve', '--accept', 'working', conflict.relPath], {
        cwd: moduleFull,
        moduleId: mod.id,
        moduleName: mod.name,
      });
      return { output: stdout.trim() || `Resolved '${conflict.relPath}'` };
    }

    const output = `Resolved '${conflict.relPath}' (working copy saved cleanly)`;
    recordInstantCommandLog({
      moduleId: mod.id,
      moduleName: mod.name,
      command: `svn resolve --accept working "${conflict.relPath}"`,
      status: 'success',
      output,
      durationMs: 90,
    });
    return { output };
  }

  // Quick accept 'source' (theirs) or 'target' (mine)
  if (tracked) {
    if (strategy === 'source' && tracked.sourceFullPath && fs.existsSync(tracked.sourceFullPath)) {
      await fsp.mkdir(path.dirname(tracked.targetFullPath), { recursive: true });
      await fsp.copyFile(tracked.sourceFullPath, tracked.targetFullPath);
    } else if (strategy === 'target' && tracked.preMergeTargetContent !== undefined) {
      await fsp.writeFile(tracked.targetFullPath, tracked.preMergeTargetContent);
    }
    removeTrackedConflictById(tracked.id);

    if (settings.mode === 'real') {
      // If SVN also tracks a conflict here, mark working
      await execSvn(['resolve', '--accept', 'working', conflict.relPath], {
        cwd: moduleFull,
        quiet: true,
      }).catch(() => undefined);
    }

    const output = `Resolved '${conflict.relPath}' using ${strategy === 'source' ? 'incoming source' : 'target current'}`;
    recordInstantCommandLog({
      moduleId: mod.id,
      moduleName: mod.name,
      command: `svn resolve --accept ${strategy === 'source' ? 'theirs-full' : 'mine-full'} "${conflict.relPath}"`,
      status: 'success',
      output,
      durationMs: 100,
    });
    return { output };
  }

  // Pure SVN conflict
  if (settings.mode === 'real') {
    const acceptArg = strategy === 'source' ? 'theirs-full' : 'mine-full';
    const { stdout } = await execSvn(['resolve', '--accept', acceptArg, conflict.relPath], {
      cwd: moduleFull,
      moduleId: mod.id,
      moduleName: mod.name,
    });
    return { output: stdout.trim() || `Resolved '${conflict.relPath}' (${acceptArg})` };
  }

  // Sample fallback if user manually wrote markers in a file outside trackedConflicts
  const baseBuf = getSampleBaselineBuffer(mod.paths[env.id] ?? '', conflict.relPath);
  if (strategy === 'target' && baseBuf) {
    await fsp.writeFile(conflict.targetFullPath, baseBuf);
  }
  return { output: `Resolved '${conflict.relPath}'` };
}
