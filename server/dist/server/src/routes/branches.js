"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchesRouter = void 0;
const express_1 = require("express");
const store_1 = require("../config/store");
const providerManager_1 = require("../providers/providerManager");
const pathSafety_1 = require("../utils/pathSafety");
exports.branchesRouter = (0, express_1.Router)();
exports.branchesRouter.get('/', (_req, res) => {
    const branches = (0, providerManager_1.getActiveBranches)().sort((a, b) => Number(b.isMaster) - Number(a.isMaster));
    res.json(branches);
});
exports.branchesRouter.post('/', async (req, res, next) => {
    try {
        const { name, path, isMaster, color } = req.body ?? {};
        if (!path || typeof path !== 'string') {
            res.status(400).json({ error: 'Working copy folder path is required.' });
            return;
        }
        const created = await (0, providerManager_1.addActiveBranch)({
            name: typeof name === 'string' && name.trim() ? name : path,
            path,
            isMaster: Boolean(isMaster),
            color: typeof color === 'string' ? color : undefined,
        });
        await (0, store_1.appendOperationHistory)({
            action: 'branch.add',
            branchName: created.name,
            details: `Added branch ${created.name} (${created.path})`,
            status: 'success',
        });
        res.status(201).json(created);
    }
    catch (err) {
        next(err);
    }
});
exports.branchesRouter.put('/:id', async (req, res, next) => {
    try {
        const updated = await (0, providerManager_1.updateActiveBranch)(req.params.id, req.body ?? {});
        res.json(updated);
    }
    catch (err) {
        next(err);
    }
});
exports.branchesRouter.delete('/:id', async (req, res, next) => {
    try {
        await (0, providerManager_1.removeActiveBranch)(req.params.id);
        await (0, store_1.appendOperationHistory)({
            action: 'branch.remove',
            details: `Removed branch ${req.params.id}`,
            status: 'success',
        });
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
exports.branchesRouter.post('/:id/set-master', async (req, res, next) => {
    try {
        const branches = await (0, providerManager_1.setActiveMasterBranch)(req.params.id);
        res.json(branches);
    }
    catch (err) {
        next(err);
    }
});
exports.branchesRouter.post('/scan', async (req, res, next) => {
    try {
        const rootDir = String(req.body?.rootDir ?? '').trim();
        if (!rootDir) {
            res.status(400).json({ error: 'Root folder path is required.' });
            return;
        }
        const existingPaths = (0, providerManager_1.getActiveBranches)().map((b) => b.path);
        if ((0, store_1.getSettings)().mode === 'demo' && rootDir.toLowerCase().includes('companysvn')) {
            const demoCandidates = [
                { name: 'erp-master', path: 'D:\\CompanySVN\\erp-master' },
                { name: 'erp-billing-v2', path: 'D:\\CompanySVN\\erp-billing-v2' },
                { name: 'erp-patient-portal', path: 'D:\\CompanySVN\\erp-patient-portal' },
                { name: 'erp-hotfix-auth', path: 'D:\\CompanySVN\\erp-hotfix-auth' },
                { name: 'erp-mobile-api', path: 'D:\\CompanySVN\\erp-mobile-api' },
            ];
            const existingSet = new Set(existingPaths.map((p) => p.toLowerCase()));
            res.json(demoCandidates.map((c) => ({
                ...c,
                alreadyAdded: existingSet.has(c.path.toLowerCase()),
            })));
            return;
        }
        const found = await (0, pathSafety_1.scanForSvnWorkingCopies)(rootDir, existingPaths, 3);
        res.json(found);
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=branches.js.map