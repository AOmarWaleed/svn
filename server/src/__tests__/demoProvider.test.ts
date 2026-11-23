import { describe, expect, it } from 'vitest';
import { DemoSvnProvider } from '../providers/DemoSvnProvider';

describe('DemoSvnProvider full workflow', () => {
  it('runs dry-run merge, executes real merge with conflicts, resolves them, commits, and resets cleanly', async () => {
    const demo = new DemoSvnProvider();
    const branches = demo.getBranches();
    expect(branches).toHaveLength(4);

    const master = branches.find((b) => b.isMaster)!;
    const billing = branches.find((b) => b.id === 'demo-billing')!;
    const portal = branches.find((b) => b.id === 'demo-portal')!;
    const hotfix = branches.find((b) => b.id === 'demo-hotfix')!;

    // 1. Hotfix starts with 1 local mod and 2 incoming updates
    const hotfixStatus = await demo.getBranchStatus(hotfix, true);
    expect(hotfixStatus.counts.modified).toBe(1);
    expect(hotfixStatus.counts.incoming).toBe(2);

    const updateRes = await demo.updateBranch(hotfix);
    expect(updateRes.newRevision).toBeGreaterThan(148);
    const hotfixAfterUpdate = await demo.getBranchStatus(hotfix, true);
    expect(hotfixAfterUpdate.counts.incoming).toBe(0);

    // 2. Dry-run merge billing -> master predicts conflicts without mutating master
    const preview = await demo.testMerge(billing, master, 'all');
    expect(preview.dryRun).toBe(true);
    expect(preview.summary.textConflicts).toBe(2);
    expect(preview.summary.treeConflicts).toBe(1);

    const masterBeforeExec = await demo.getBranchStatus(master);
    expect(masterBeforeExec.isClean).toBe(true);

    // 3. Execute real merge billing -> master
    const execRes = await demo.executeMerge(billing, master, 'all');
    expect(execRes.dryRun).toBe(false);
    expect(execRes.hasConflicts).toBe(true);
    expect(execRes.conflictedFiles).toHaveLength(3);

    // 4. Inspect conflict detail and resolve text + tree conflicts
    const invoiceConflict = await demo.getConflictDetail(master, 'src/services/invoiceCalculator.ts');
    expect(invoiceConflict.kind).toBe('text');
    expect(invoiceConflict.hunks).toHaveLength(2);

    // Unresolved markers must be rejected
    await expect(
      demo.saveAndResolveConflict(master, 'src/services/invoiceCalculator.ts', invoiceConflict.rawContent)
    ).rejects.toThrow(/unresolved conflict/i);

    await demo.saveAndResolveConflict(
      master,
      'src/services/invoiceCalculator.ts',
      'export function calculateInvoiceTotal() { return 100; }'
    );
    await demo.quickResolveConflict(master, 'src/config/taxRules.ts', 'theirs-full');
    await demo.quickResolveConflict(master, 'src/legacy/oldReport.ts', 'working');

    const remainingConflicts = await demo.listConflicts(master);
    expect(remainingConflicts).toHaveLength(0);

    // 5. Commit master cleanly
    const masterStatusReady = await demo.getBranchStatus(master);
    const filesToCommit = masterStatusReady.files.map((f) => f.path);
    const commitRes = await demo.commitBranch(master, filesToCommit, preview.suggestedCommitMessage);
    expect(commitRes.newRevision).toBeGreaterThan(142);

    const masterAfterCommit = await demo.getBranchStatus(master);
    expect(masterAfterCommit.isClean).toBe(true);

    // 6. Clean merge portal -> master & rollback
    const portalPreview = await demo.testMerge(portal, master, 'all');
    expect(portalPreview.summary.textConflicts).toBe(0);
    expect(portalPreview.summary.treeConflicts).toBe(0);

    const portalExec = await demo.executeMerge(portal, master, 'all');
    expect(portalExec.hasConflicts).toBe(false);

    await demo.revert(master);
    const masterAfterRollback = await demo.getBranchStatus(master);
    expect(masterAfterRollback.isClean).toBe(true);

    // 7. Reset restores initial state
    demo.resetDemo();
    const eligibleAfterReset = await demo.getEligibleRevisions(billing, master);
    expect(eligibleAfterReset).toHaveLength(3);
  });
});
