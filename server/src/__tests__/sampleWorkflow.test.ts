import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getActiveRepoRoot, initConfigStore, updateSettings } from '../config/store';
import { clearAllTrackedConflicts } from '../engines/conflictTracker';
import { applyFolderSyncBatch, previewFolderSyncBatch } from '../engines/folderSyncEngine';
import {
  commitModuleEnv,
  getAllActiveConflicts,
  getRepoOverview,
  resolveConflictItem,
} from '../engines/svnEngine';
import { resetSampleRepo } from '../sample/sampleRcmBuilder';

describe('Sample RCM end-to-end workflow', () => {
  it('initializes sample-rcm on disk, transfers DEV -> MASTER, detects markers, resolves after disk edit, and commits', async () => {
    await initConfigStore();
    await updateSettings({ mode: 'sample' });
    clearAllTrackedConflicts();
    await resetSampleRepo();

    const overview = await getRepoOverview();
    expect(overview.mode).toBe('sample');
    expect(overview.rows).toHaveLength(11);
    expect(overview.revision).toBe(7425);

    const billingRow = overview.rows.find((r) => r.module.id === 'billing-backend')!;
    expect(billingRow.envs.master.relativePath).toBe('billing/rcm-api');
    expect(billingRow.envs.dev.relativePath).toBe('BRANCHES/DEV/billing/backend');
    expect(billingRow.envs.master.exists).toBe(true);
    expect(billingRow.envs.dev.exists).toBe(true);

    // Apply Folder Sync DEV -> MASTER for billing-backend
    const devEnv = overview.envs.find((e) => e.id === 'dev')!;
    const masterEnv = overview.envs.find((e) => e.id === 'master')!;
    const repoRoot = getActiveRepoRoot();

    const { getSettings } = await import('../config/store');
    const settings = getSettings();
    const preview = await previewFolderSyncBatch(repoRoot, devEnv, masterEnv, [billingRow.module], settings);
    expect(preview[0].counts.added).toBeGreaterThanOrEqual(1);
    expect(preview[0].counts.protected).toBeGreaterThanOrEqual(1);

    const applied = await applyFolderSyncBatch(repoRoot, devEnv, masterEnv, [billingRow.module], [], settings);
    expect(applied.conflicts.length).toBeGreaterThanOrEqual(1);

    const activeConflicts = await getAllActiveConflicts();
    const claimConflict = activeConflicts.find((c) => c.relPath === 'src/services/claimCalculator.ts')!;
    expect(claimConflict).toBeDefined();
    expect(claimConflict.markerCount).toBeGreaterThanOrEqual(1);
    expect(claimConflict.readyToResolve).toBe(false);

    // Resolving while markers still exist must fail
    await expect(resolveConflictItem(claimConflict.id, 'working')).rejects.toThrow(/unresolved/i);

    // Simulate user resolving conflict in VS Code and saving clean file on disk
    await fsp.writeFile(claimConflict.targetFullPath, 'export function calculateClaimNet() { return 42; }\n', 'utf8');

    const refreshedConflicts = await getAllActiveConflicts();
    const readyClaim = refreshedConflicts.find((c) => c.id === claimConflict.id)!;
    expect(readyClaim.markerCount).toBe(0);
    expect(readyClaim.readyToResolve).toBe(true);

    await resolveConflictItem(claimConflict.id, 'working');

    // Quick resolve remaining conflicts in billing-backend
    for (const c of (await getAllActiveConflicts()).filter((x) => x.moduleId === 'billing-backend')) {
      await resolveConflictItem(c.id, 'source');
    }

    const postResolveOverview = await getRepoOverview();
    const billingMaster = postResolveOverview.rows.find((r) => r.module.id === 'billing-backend')!.envs.master;
    expect(billingMaster.conflictCount).toBe(0);
    expect(billingMaster.files.length).toBeGreaterThan(0);

    // Commit resolved billing-backend on MASTER
    const commitRes = await commitModuleEnv(
      'billing-backend',
      'master',
      billingMaster.files.map((f) => f.path),
      'Merged billing backend from DEV to MASTER'
    );
    expect(commitRes.newRevision).toBe(7426);

    // Reset restores clean r7425
    await resetSampleRepo();
    clearAllTrackedConflicts();
    expect(fs.existsSync(claimConflict.targetFullPath)).toBe(true);
  });
});
