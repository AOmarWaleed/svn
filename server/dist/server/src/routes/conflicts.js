"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conflictsRouter = void 0;
const express_1 = require("express");
const store_1 = require("../config/store");
const providerManager_1 = require("../providers/providerManager");
exports.conflictsRouter = (0, express_1.Router)();
exports.conflictsRouter.get('/', async (_req, res, next) => {
    try {
        const provider = (0, providerManager_1.getActiveProvider)();
        const branches = (0, providerManager_1.getActiveBranches)().sort((a, b) => Number(b.isMaster) - Number(a.isMaster));
        const lists = await Promise.all(branches.map(async (branch) => {
            const files = await provider.listConflicts(branch);
            return files.map((file) => ({
                branchId: branch.id,
                branchName: branch.name,
                isMaster: branch.isMaster,
                file,
            }));
        }));
        res.json(lists.flat());
    }
    catch (err) {
        next(err);
    }
});
exports.conflictsRouter.get('/:branchId/detail', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const filePath = String(req.query.file ?? '');
        if (!filePath) {
            res.status(400).json({ error: 'file query parameter is required.' });
            return;
        }
        const detail = await (0, providerManager_1.getActiveProvider)().getConflictDetail(branch, filePath);
        res.json(detail);
    }
    catch (err) {
        next(err);
    }
});
exports.conflictsRouter.post('/:branchId/save-resolve', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const filePath = String(req.body?.filePath ?? '');
        const resolvedContent = String(req.body?.resolvedContent ?? '');
        if (!filePath) {
            res.status(400).json({ error: 'filePath is required.' });
            return;
        }
        const result = await (0, providerManager_1.getActiveProvider)().saveAndResolveConflict(branch, filePath, resolvedContent);
        await (0, store_1.appendOperationHistory)({
            action: 'conflict.resolve',
            branchName: branch.name,
            details: `Saved & resolved ${filePath} on ${branch.name}`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.conflictsRouter.post('/:branchId/quick-resolve', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const filePath = String(req.body?.filePath ?? '');
        const strategy = String(req.body?.strategy ?? '');
        const valid = [
            'mine-full',
            'theirs-full',
            'working',
            'mine-conflict',
            'theirs-conflict',
        ];
        if (!filePath || !valid.includes(strategy)) {
            res.status(400).json({ error: 'Valid filePath and strategy are required.' });
            return;
        }
        const result = await (0, providerManager_1.getActiveProvider)().quickResolveConflict(branch, filePath, strategy);
        await (0, store_1.appendOperationHistory)({
            action: 'conflict.quickResolve',
            branchName: branch.name,
            details: `Resolved ${filePath} (${strategy}) on ${branch.name}`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=conflicts.js.map