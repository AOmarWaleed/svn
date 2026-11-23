"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settingsRouter = void 0;
exports.resetDemoHandler = resetDemoHandler;
const express_1 = require("express");
const store_1 = require("../config/store");
const providerManager_1 = require("../providers/providerManager");
const commandLogger_1 = require("../utils/commandLogger");
exports.settingsRouter = (0, express_1.Router)();
exports.settingsRouter.get('/', (_req, res) => {
    res.json((0, store_1.getPublicSettings)());
});
exports.settingsRouter.put('/', async (req, res, next) => {
    try {
        const payload = (req.body ?? {});
        const updated = await (0, store_1.updateSettings)(payload);
        await (0, store_1.appendOperationHistory)({
            action: 'settings.update',
            details: `Updated settings (mode: ${updated.mode})`,
            status: 'success',
        });
        res.json(updated);
    }
    catch (err) {
        next(err);
    }
});
exports.settingsRouter.post('/test-svn', async (req, res, next) => {
    try {
        const svnPath = String(req.body?.svnPath ?? '').trim() || 'svn';
        const result = await (0, store_1.testSvnExecutable)(svnPath);
        const detected = await (0, store_1.detectInstalledSvnPaths)();
        res.json({ ...result, detectedSvnPaths: detected });
    }
    catch (err) {
        next(err);
    }
});
async function resetDemoHandler(_req, res, next) {
    try {
        (0, providerManager_1.getDemoProvider)().resetDemo();
        (0, commandLogger_1.clearCommandLogs)();
        (0, commandLogger_1.recordInstantCommandLog)({
            command: 'demo reset --restore-initial-state',
            status: 'success',
            output: 'Demo sandbox reset to initial 4 branches and unmerged feature commits.',
            durationMs: 25,
        });
        await (0, store_1.appendOperationHistory)({
            action: 'demo.reset',
            details: 'Reset Demo Sandbox to initial state',
            status: 'success',
        });
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
}
exports.settingsRouter.post('/demo/reset', resetDemoHandler);
//# sourceMappingURL=settings.js.map