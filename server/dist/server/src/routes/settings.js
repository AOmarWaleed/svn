"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settingsRouter = void 0;
exports.resetSampleHandler = resetSampleHandler;
const express_1 = require("express");
const store_1 = require("../config/store");
const conflictTracker_1 = require("../engines/conflictTracker");
const sampleRcmBuilder_1 = require("../sample/sampleRcmBuilder");
const commandLogger_1 = require("../utils/commandLogger");
const vscodeLauncher_1 = require("../utils/vscodeLauncher");
exports.settingsRouter = (0, express_1.Router)();
exports.settingsRouter.get('/', (_req, res) => {
    res.json((0, store_1.getPublicSettings)());
});
exports.settingsRouter.put('/', async (req, res, next) => {
    try {
        const payload = (req.body ?? {});
        const updated = await (0, store_1.updateSettings)(payload);
        if (updated.mode === 'sample') {
            await (0, sampleRcmBuilder_1.ensureSampleRepoInitialized)();
        }
        await (0, store_1.appendOperationHistory)({
            action: 'settings.update',
            details: `Updated settings (mode: ${updated.mode}, root: ${updated.activeRepoRoot})`,
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
        const [result, detected] = await Promise.all([
            (0, store_1.testSvnExecutable)(svnPath),
            (0, store_1.detectInstalledSvnPaths)(),
        ]);
        res.json({ ...result, detectedSvnPaths: detected });
    }
    catch (err) {
        next(err);
    }
});
exports.settingsRouter.post('/test-vscode', async (_req, res, next) => {
    try {
        const vscodePath = await (0, vscodeLauncher_1.detectVsCodePath)();
        res.json({
            available: Boolean(vscodePath),
            vscodePath,
        });
    }
    catch (err) {
        next(err);
    }
});
async function resetSampleHandler(_req, res, next) {
    try {
        (0, conflictTracker_1.clearAllTrackedConflicts)();
        const root = await (0, sampleRcmBuilder_1.resetSampleRepo)();
        (0, commandLogger_1.clearCommandLogs)();
        (0, commandLogger_1.recordInstantCommandLog)({
            command: `sample-rcm reset "${root}"`,
            status: 'success',
            output: 'Sample RCM repository restored cleanly to initial r7425 state.',
            durationMs: 40,
        });
        await (0, store_1.appendOperationHistory)({
            action: 'sample.reset',
            details: 'Reset Sample RCM repository on disk to initial state',
            status: 'success',
        });
        res.json({ ok: true, sampleRepoRoot: root });
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=settings.js.map