"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRouter = void 0;
const express_1 = require("express");
const store_1 = require("../config/store");
exports.healthRouter = (0, express_1.Router)();
exports.healthRouter.get('/', async (_req, res, next) => {
    try {
        const settings = (0, store_1.getSettings)();
        const detected = (0, store_1.getCachedDetectedSvnPaths)().length > 0
            ? (0, store_1.getCachedDetectedSvnPaths)()
            : await (0, store_1.detectInstalledSvnPaths)();
        const svnTest = await (0, store_1.testSvnExecutable)(settings.svnPath);
        const info = {
            ok: true,
            mode: settings.mode,
            svnAvailable: svnTest.available,
            svnVersion: svnTest.version,
            svnPath: settings.svnPath,
            detectedSvnPaths: detected,
            editorCommand: settings.editorCommand,
            platform: process.platform,
        };
        res.json(info);
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=health.js.map