"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemRouter = void 0;
const express_1 = require("express");
const store_1 = require("../config/store");
const pathSafety_1 = require("../utils/pathSafety");
const vscodeLauncher_1 = require("../utils/vscodeLauncher");
exports.systemRouter = (0, express_1.Router)();
exports.systemRouter.post('/open-folder', (req, res, next) => {
    try {
        const { moduleId, envId } = req.body ?? {};
        const repoRoot = (0, store_1.getActiveRepoRoot)();
        let targetPath = repoRoot;
        if (moduleId && envId) {
            const mod = (0, store_1.getModuleById)(String(moduleId));
            const rel = mod.paths[String(envId)];
            if (!rel) {
                res.status(400).json({ error: 'No mapped path for this module/environment.' });
                return;
            }
            targetPath = (0, pathSafety_1.resolveInsideRoot)(repoRoot, rel);
        }
        (0, vscodeLauncher_1.openFolderInExplorer)(targetPath);
        res.json({ ok: true, path: targetPath });
    }
    catch (err) {
        next(err);
    }
});
exports.systemRouter.post('/open-vscode-folder', async (req, res, next) => {
    try {
        const { moduleId, envId } = req.body ?? {};
        const repoRoot = (0, store_1.getActiveRepoRoot)();
        let targetPath = repoRoot;
        if (moduleId && envId) {
            const mod = (0, store_1.getModuleById)(String(moduleId));
            const rel = mod.paths[String(envId)];
            if (!rel) {
                res.status(400).json({ error: 'No mapped path for this module/environment.' });
                return;
            }
            targetPath = (0, pathSafety_1.resolveInsideRoot)(repoRoot, rel);
        }
        const settings = (0, store_1.getSettings)();
        const bin = await (0, vscodeLauncher_1.openFilesInEditor)([targetPath], settings.editorCommand);
        res.json({ ok: true, launched: bin, path: targetPath });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=system.js.map