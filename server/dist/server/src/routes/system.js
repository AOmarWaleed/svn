"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemRouter = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const express_1 = require("express");
const store_1 = require("../config/store");
const providerManager_1 = require("../providers/providerManager");
const pathSafety_1 = require("../utils/pathSafety");
exports.systemRouter = (0, express_1.Router)();
exports.systemRouter.post('/open-editor', (req, res, next) => {
    try {
        const { branchId, filePath } = req.body ?? {};
        if (!branchId || !filePath) {
            res.status(400).json({ error: 'branchId and filePath are required.' });
            return;
        }
        const branch = (0, providerManager_1.getActiveBranchById)(String(branchId));
        const fullPath = (0, pathSafety_1.resolveSafeFilePath)(branch.path, String(filePath));
        const settings = (0, store_1.getSettings)();
        if (settings.mode === 'demo') {
            res.json({
                ok: true,
                simulated: true,
                fullPath,
                editor: settings.editorCommand || 'code',
                message: `Demo mode: simulated opening ${fullPath} in "${settings.editorCommand || 'code'}".`,
            });
            return;
        }
        if (!node_fs_1.default.existsSync(fullPath)) {
            res.status(404).json({ error: `File does not exist on disk: ${fullPath}` });
            return;
        }
        const editorCmd = (settings.editorCommand || 'code').trim();
        if (process.platform === 'win32') {
            if (editorCmd === 'default') {
                const child = (0, node_child_process_1.spawn)('cmd.exe', ['/c', 'start', '', fullPath], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true,
                });
                child.unref();
            }
            else {
                const child = (0, node_child_process_1.spawn)('cmd.exe', ['/c', editorCmd, fullPath], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true,
                });
                child.unref();
            }
        }
        else {
            const cmd = editorCmd === 'default' ? 'xdg-open' : editorCmd;
            const child = (0, node_child_process_1.spawn)(cmd, [fullPath], { detached: true, stdio: 'ignore' });
            child.unref();
        }
        res.json({ ok: true, simulated: false, fullPath, editor: editorCmd });
    }
    catch (err) {
        next(err);
    }
});
exports.systemRouter.post('/open-folder', (req, res, next) => {
    try {
        const { branchId } = req.body ?? {};
        if (!branchId) {
            res.status(400).json({ error: 'branchId is required.' });
            return;
        }
        const branch = (0, providerManager_1.getActiveBranchById)(String(branchId));
        const settings = (0, store_1.getSettings)();
        if (settings.mode === 'demo') {
            res.json({
                ok: true,
                simulated: true,
                path: branch.path,
                message: `Demo mode: simulated opening folder ${branch.path}.`,
            });
            return;
        }
        if (!node_fs_1.default.existsSync(branch.path)) {
            res.status(404).json({ error: `Folder not found on disk: ${branch.path}` });
            return;
        }
        if (process.platform === 'win32') {
            const child = (0, node_child_process_1.spawn)('explorer.exe', [branch.path], {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
        }
        else {
            const child = (0, node_child_process_1.spawn)('xdg-open', [branch.path], {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
        }
        res.json({ ok: true, simulated: false, path: branch.path });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=system.js.map