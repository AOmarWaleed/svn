import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSettings, EnvConfig, ModuleMapping } from '../../../shared/types';
import { DEFAULT_IGNORE_PATTERNS, DEFAULT_PROTECTED_PATTERNS } from '../config/defaults';
import { clearAllTrackedConflicts, executeRollbackSnapshot } from '../engines/conflictTracker';
import { applyFolderSyncBatch, previewFolderSyncBatch } from '../engines/folderSyncEngine';

const tmpDirs: string[] = [];

afterEach(async () => {
  clearAllTrackedConflicts();
  for (const d of tmpDirs.splice(0)) {
    await fsp.rm(d, { recursive: true, force: true });
  }
});

describe('folderSyncEngine', () => {
  it('maps mismatched folders, protects .env, skips node_modules, keeps target-only, marks conflicts, and rolls back', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rcm-sync-'));
    tmpDirs.push(root);

    const srcDir = path.join(root, 'BRANCHES', 'DEV', 'billing', 'backend');
    const tgtDir = path.join(root, 'billing', 'rcm-api');

    await fsp.mkdir(path.join(srcDir, 'src'), { recursive: true });
    await fsp.mkdir(path.join(srcDir, 'node_modules', 'pkg'), { recursive: true });
    await fsp.mkdir(path.join(tgtDir, 'src'), { recursive: true });
    await fsp.mkdir(path.join(tgtDir, 'node_modules', 'pkg'), { recursive: true });

    await fsp.writeFile(path.join(srcDir, 'src', 'calc.ts'), 'const v = 2;\n', 'utf8');
    await fsp.writeFile(path.join(tgtDir, 'src', 'calc.ts'), 'const v = 1;\n', 'utf8');
    await fsp.writeFile(path.join(srcDir, 'src', 'newFile.ts'), 'export const added = true;\n', 'utf8');
    await fsp.writeFile(path.join(tgtDir, 'src', 'masterOnly.ts'), 'export const keep = true;\n', 'utf8');
    await fsp.writeFile(path.join(srcDir, '.env'), 'DB=DEV\n', 'utf8');
    await fsp.writeFile(path.join(tgtDir, '.env'), 'DB=PROD\n', 'utf8');
    await fsp.writeFile(path.join(srcDir, 'node_modules', 'pkg', 'index.js'), 'dev', 'utf8');

    const sourceEnv: EnvConfig = { id: 'dev', label: 'DEV', basePath: 'BRANCHES/DEV', color: '#6366f1', isMaster: false };
    const targetEnv: EnvConfig = { id: 'master', label: 'MASTER', basePath: '', color: '#10b981', isMaster: true };
    const mod: ModuleMapping = {
      id: 'billing-backend',
      name: 'Billing Backend',
      category: 'Billing',
      paths: { dev: 'BRANCHES/DEV/billing/backend', master: 'billing/rcm-api' },
    };
    const settings: AppSettings = {
      mode: 'real',
      repoRoot: root,
      svnPath: 'svn',
      editorCommand: 'code',
      authMode: 'cached',
      username: '',
      password: '',
      trustServerCert: true,
      ignorePatterns: DEFAULT_IGNORE_PATTERNS,
      protectedPatterns: DEFAULT_PROTECTED_PATTERNS,
    };

    const previews = await previewFolderSyncBatch(root, sourceEnv, targetEnv, [mod], settings);
    expect(previews).toHaveLength(1);
    expect(previews[0].counts).toEqual({
      added: 1,
      modified: 1,
      targetOnly: 1,
      protected: 1,
    });
    expect(previews[0].ignoredCount).toBeGreaterThan(0);

    const applied = await applyFolderSyncBatch(root, sourceEnv, targetEnv, [mod], [], settings);
    expect(applied.appliedModules[0].copied).toBe(1);
    expect(applied.appliedModules[0].markedConflict).toBe(1);
    expect(applied.appliedModules[0].skipped).toBe(2); // .env + masterOnly.ts
    expect(applied.conflicts).toHaveLength(1);

    // .env and masterOnly.ts must remain untouched
    expect(await fsp.readFile(path.join(tgtDir, '.env'), 'utf8')).toBe('DB=PROD\n');
    expect(fs.existsSync(path.join(tgtDir, 'src', 'masterOnly.ts'))).toBe(true);
    // newFile copied, calc.ts has conflict markers
    expect(fs.existsSync(path.join(tgtDir, 'src', 'newFile.ts'))).toBe(true);
    const calcContent = await fsp.readFile(path.join(tgtDir, 'src', 'calc.ts'), 'utf8');
    expect(calcContent).toContain('<<<<<<<');

    // Rollback restores exact prior disk state
    await executeRollbackSnapshot(applied.rollbackId);
    expect(fs.existsSync(path.join(tgtDir, 'src', 'newFile.ts'))).toBe(false);
    expect(await fsp.readFile(path.join(tgtDir, 'src', 'calc.ts'), 'utf8')).toBe('const v = 1;\n');
  });
});
