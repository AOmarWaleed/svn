"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conflictsRouter = void 0;
const express_1 = require("express");
const store_1 = require("../config/store");
const svnEngine_1 = require("../engines/svnEngine");
const vscodeLauncher_1 = require("../utils/vscodeLauncher");
exports.conflictsRouter = (0, express_1.Router)();
exports.conflictsRouter.get('/', async (_req, res, next) => {
    try {
        const items = await (0, svnEngine_1.getAllActiveConflicts)();
        res.json(items);
    }
    catch (err) {
        next(err);
    }
});
exports.conflictsRouter.post('/resolve', async (req, res, next) => {
    try {
        const { conflictId, strategy } = req.body ?? {};
        if (!conflictId || !['working', 'source', 'target'].includes(String(strategy))) {
            res.status(400).json({ error: 'conflictId and valid strategy (working|source|target) required.' });
            return;
        }
        const result = await (0, svnEngine_1.resolveConflictItem)(String(conflictId), strategy);
        await (0, store_1.appendOperationHistory)({
            action: 'conflict.resolve',
            details: `Resolved conflict ${conflictId} (${strategy})`,
            status: 'success',
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.conflictsRouter.post('/open-vscode', async (req, res, next) => {
    try {
        const { conflictId, mode } = req.body ?? {};
        if (!conflictId) {
            res.status(400).json({ error: 'conflictId is required.' });
            return;
        }
        const items = await (0, svnEngine_1.getAllActiveConflicts)();
        const conflict = items.find((c) => c.id === conflictId);
        if (!conflict) {
            res.status(404).json({ error: `Conflict item not found: ${conflictId}` });
            return;
        }
        const settings = (0, store_1.getSettings)();
        if (mode === 'diff' && conflict.sourceFullPath) {
            const bin = await (0, vscodeLauncher_1.openDiffInVsCode)(conflict.sourceFullPath, conflict.targetFullPath, settings.editorCommand);
            res.json({ ok: true, launched: bin, mode: 'diff', target: conflict.targetFullPath });
            return;
        }
        const bin = await (0, vscodeLauncher_1.openFilesInEditor)([conflict.targetFullPath], settings.editorCommand);
        res.json({ ok: true, launched: bin, mode: 'file', target: conflict.targetFullPath });
    }
    catch (err) {
        next(err);
    }
});
exports.conflictsRouter.post('/open-all-vscode', async (req, res, next) => {
    try {
        const { targetEnvId, moduleId } = req.body ?? {};
        const items = await (0, svnEngine_1.getAllActiveConflicts)();
        const filtered = items.filter((c) => {
            if (targetEnvId && c.targetEnvId !== targetEnvId)
                return false;
            if (moduleId && c.moduleId !== moduleId)
                return false;
            return true;
        });
        if (filtered.length === 0) {
            res.status(400).json({ error: 'No active conflicts to open.' });
            return;
        }
        const settings = (0, store_1.getSettings)();
        const paths = Array.from(new Set(filtered.map((f) => f.targetFullPath)));
        const bin = await (0, vscodeLauncher_1.openFilesInEditor)(paths, settings.editorCommand);
        res.json({ ok: true, launched: bin, count: paths.length, paths });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=conflicts.js.map