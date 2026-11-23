"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.svnRouter = void 0;
const express_1 = require("express");
const store_1 = require("../config/store");
const providerManager_1 = require("../providers/providerManager");
exports.svnRouter = (0, express_1.Router)();
exports.svnRouter.get('/status-all', async (req, res, next) => {
    try {
        const checkRemote = req.query.remote === 'true';
        const provider = (0, providerManager_1.getActiveProvider)();
        const branches = (0, providerManager_1.getActiveBranches)().sort((a, b) => Number(b.isMaster) - Number(a.isMaster));
        const statuses = await Promise.all(branches.map((branch) => provider.getBranchStatus(branch, checkRemote)));
        res.json(statuses);
    }
    catch (err) {
        next(err);
    }
});
exports.svnRouter.get('/:branchId/status', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const checkRemote = req.query.remote === 'true';
        const status = await (0, providerManager_1.getActiveProvider)().getBranchStatus(branch, checkRemote);
        res.json(status);
    }
    catch (err) {
        next(err);
    }
});
exports.svnRouter.post('/update-all', async (_req, res, next) => {
    try {
        const provider = (0, providerManager_1.getActiveProvider)();
        const branches = (0, providerManager_1.getActiveBranches)();
        const results = await Promise.all(branches.map(async (branch) => {
            try {
                const result = await provider.updateBranch(branch);
                return { branchId: branch.id, branchName: branch.name, ok: true, ...result };
            }
            catch (err) {
                return {
                    branchId: branch.id,
                    branchName: branch.name,
                    ok: false,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        }));
        await (0, store_1.appendOperationHistory)({
            action: 'svn.updateAll',
            details: `Updated ${results.filter((r) => r.ok).length}/${results.length} branches`,
            status: results.every((r) => r.ok) ? 'success' : 'error',
        });
        res.json({ results });
    }
    catch (err) {
        next(err);
    }
});
exports.svnRouter.post('/:branchId/update', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const result = await (0, providerManager_1.getActiveProvider)().updateBranch(branch);
        await (0, store_1.appendOperationHistory)({
            action: 'svn.update',
            branchName: branch.name,
            details: `Updated ${branch.name} to r${result.newRevision}`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.svnRouter.post('/:branchId/commit', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const files = Array.isArray(req.body?.files) ? req.body.files : [];
        const message = String(req.body?.message ?? '');
        const result = await (0, providerManager_1.getActiveProvider)().commitBranch(branch, files, message);
        await (0, store_1.appendOperationHistory)({
            action: 'svn.commit',
            branchName: branch.name,
            details: `Committed ${files.length} file(s) to ${branch.name}${result.newRevision ? ` (r${result.newRevision})` : ''}`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.svnRouter.get('/:branchId/diff', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const file = typeof req.query.file === 'string' && req.query.file ? req.query.file : undefined;
        const rev = typeof req.query.rev === 'string' && req.query.rev ? Number(req.query.rev) : undefined;
        const diff = await (0, providerManager_1.getActiveProvider)().getDiff(branch, file, rev);
        res.json({ diff });
    }
    catch (err) {
        next(err);
    }
});
exports.svnRouter.get('/:branchId/log', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) || 30 : 30;
        const entries = await (0, providerManager_1.getActiveProvider)().getLog(branch, limit);
        res.json(entries);
    }
    catch (err) {
        next(err);
    }
});
exports.svnRouter.post('/:branchId/revert', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const files = Array.isArray(req.body?.files) ? req.body.files : undefined;
        const result = await (0, providerManager_1.getActiveProvider)().revert(branch, files);
        await (0, store_1.appendOperationHistory)({
            action: 'svn.revert',
            branchName: branch.name,
            details: files?.length
                ? `Reverted ${files.length} file(s) on ${branch.name}`
                : `Reverted all local changes on ${branch.name}`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.svnRouter.post('/:branchId/cleanup', async (req, res, next) => {
    try {
        const branch = (0, providerManager_1.getActiveBranchById)(req.params.branchId);
        const result = await (0, providerManager_1.getActiveProvider)().cleanup(branch);
        await (0, store_1.appendOperationHistory)({
            action: 'svn.cleanup',
            branchName: branch.name,
            details: `Ran cleanup on ${branch.name}`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=svn.js.map