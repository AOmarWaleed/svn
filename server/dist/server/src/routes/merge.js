"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeRouter = void 0;
const express_1 = require("express");
const store_1 = require("../config/store");
const providerManager_1 = require("../providers/providerManager");
exports.mergeRouter = (0, express_1.Router)();
exports.mergeRouter.get('/eligible', async (req, res, next) => {
    try {
        const sourceId = String(req.query.sourceId ?? '');
        const targetId = String(req.query.targetId ?? '');
        if (!sourceId || !targetId) {
            res.status(400).json({ error: 'sourceId and targetId are required.' });
            return;
        }
        const source = (0, providerManager_1.getActiveBranchById)(sourceId);
        const target = (0, providerManager_1.getActiveBranchById)(targetId);
        const revisions = await (0, providerManager_1.getActiveProvider)().getEligibleRevisions(source, target);
        res.json(revisions);
    }
    catch (err) {
        next(err);
    }
});
exports.mergeRouter.post('/preflight', async (req, res, next) => {
    try {
        const { sourceId, targetId } = req.body ?? {};
        if (!sourceId || !targetId) {
            res.status(400).json({ error: 'sourceId and targetId are required.' });
            return;
        }
        const source = (0, providerManager_1.getActiveBranchById)(String(sourceId));
        const target = (0, providerManager_1.getActiveBranchById)(String(targetId));
        const result = await (0, providerManager_1.getActiveProvider)().preflightMerge(source, target);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.mergeRouter.post('/test', async (req, res, next) => {
    try {
        const { sourceId, targetId, mode, revisions } = req.body ?? {};
        if (!sourceId || !targetId) {
            res.status(400).json({ error: 'sourceId and targetId are required.' });
            return;
        }
        const source = (0, providerManager_1.getActiveBranchById)(String(sourceId));
        const target = (0, providerManager_1.getActiveBranchById)(String(targetId));
        const mergeMode = mode === 'revisions' ? 'revisions' : 'all';
        const revList = Array.isArray(revisions) ? revisions.map(Number).filter(Number.isFinite) : [];
        const result = await (0, providerManager_1.getActiveProvider)().testMerge(source, target, mergeMode, revList);
        await (0, store_1.appendOperationHistory)({
            action: 'merge.test',
            branchName: source.name,
            targetBranchName: target.name,
            details: `Dry-run ${source.name} -> ${target.name}: ${result.summary.total} impacted, ${result.summary.textConflicts + result.summary.treeConflicts} predicted conflict(s)`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.mergeRouter.post('/preview-diff', async (req, res, next) => {
    try {
        const { sourceId, targetId, filePath, revisions } = req.body ?? {};
        if (!sourceId || !targetId || !filePath) {
            res.status(400).json({ error: 'sourceId, targetId, and filePath are required.' });
            return;
        }
        const source = (0, providerManager_1.getActiveBranchById)(String(sourceId));
        const target = (0, providerManager_1.getActiveBranchById)(String(targetId));
        const revList = Array.isArray(revisions) ? revisions.map(Number).filter(Number.isFinite) : [];
        const diff = await (0, providerManager_1.getActiveProvider)().getMergeFileDiff(source, target, String(filePath), revList);
        res.json({ diff });
    }
    catch (err) {
        next(err);
    }
});
exports.mergeRouter.post('/confirm', async (req, res, next) => {
    try {
        const { sourceId, targetId, mode, revisions } = req.body ?? {};
        if (!sourceId || !targetId) {
            res.status(400).json({ error: 'sourceId and targetId are required.' });
            return;
        }
        const source = (0, providerManager_1.getActiveBranchById)(String(sourceId));
        const target = (0, providerManager_1.getActiveBranchById)(String(targetId));
        const mergeMode = mode === 'revisions' ? 'revisions' : 'all';
        const revList = Array.isArray(revisions) ? revisions.map(Number).filter(Number.isFinite) : [];
        const result = await (0, providerManager_1.getActiveProvider)().executeMerge(source, target, mergeMode, revList);
        await (0, store_1.appendOperationHistory)({
            action: 'merge.confirm',
            branchName: source.name,
            targetBranchName: target.name,
            details: result.hasConflicts
                ? `Merged ${source.name} -> ${target.name} with ${result.conflictedFiles.length} conflict(s)`
                : `Cleanly merged ${source.name} -> ${target.name} (${result.summary.total} files)`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.mergeRouter.post('/rollback', async (req, res, next) => {
    try {
        const { targetId } = req.body ?? {};
        if (!targetId) {
            res.status(400).json({ error: 'targetId is required.' });
            return;
        }
        const target = (0, providerManager_1.getActiveBranchById)(String(targetId));
        const result = await (0, providerManager_1.getActiveProvider)().revert(target);
        await (0, store_1.appendOperationHistory)({
            action: 'merge.rollback',
            targetBranchName: target.name,
            details: `Rolled back local merge changes on ${target.name}`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=merge.js.map