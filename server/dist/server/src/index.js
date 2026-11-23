"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const store_1 = require("./config/store");
const conflicts_1 = require("./routes/conflicts");
const health_1 = require("./routes/health");
const logs_1 = require("./routes/logs");
const modules_1 = require("./routes/modules");
const overview_1 = require("./routes/overview");
const settings_1 = require("./routes/settings");
const system_1 = require("./routes/system");
const transfer_1 = require("./routes/transfer");
const sampleRcmBuilder_1 = require("./sample/sampleRcmBuilder");
const pathSafety_1 = require("./utils/pathSafety");
async function createApp() {
    await (0, store_1.initConfigStore)();
    if ((0, store_1.getSettings)().mode === 'sample') {
        await (0, sampleRcmBuilder_1.ensureSampleRepoInitialized)();
    }
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '10mb' }));
    app.use('/api/health', health_1.healthRouter);
    app.use('/api/settings', settings_1.settingsRouter);
    app.post('/api/sample/reset', settings_1.resetSampleHandler);
    app.use('/api/modules', modules_1.modulesRouter);
    app.use('/api', overview_1.overviewRouter);
    app.use('/api/transfer', transfer_1.transferRouter);
    app.use('/api/conflicts', conflicts_1.conflictsRouter);
    app.use('/api/system', system_1.systemRouter);
    app.use('/api/logs', logs_1.logsRouter);
    app.get('/api/history', (_req, res) => {
        res.json((0, store_1.getOperationHistory)());
    });
    const clientDist = node_path_1.default.join((0, pathSafety_1.getProjectRoot)(), 'client', 'dist');
    if (node_fs_1.default.existsSync(node_path_1.default.join(clientDist, 'index.html'))) {
        app.use(express_1.default.static(clientDist));
        app.get('*', (req, res, next) => {
            if (req.path.startsWith('/api')) {
                next();
                return;
            }
            res.sendFile(node_path_1.default.join(clientDist, 'index.html'));
        });
    }
    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'API endpoint not found.' });
    });
    app.use((err, _req, res, _next) => {
        const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
        res.status(status).json({ error: err.message || 'Internal server error' });
    });
    return app;
}
async function main() {
    const app = await createApp();
    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || 4100);
    app.listen(port, host, () => {
        const settings = (0, store_1.getSettings)();
        console.log(`[RCM SVN Hub] Server listening at http://${host}:${port} (mode=${settings.mode})`);
    });
}
if (require.main === module) {
    main().catch((err) => {
        console.error('[RCM SVN Hub] Startup error:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map