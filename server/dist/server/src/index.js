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
const branches_1 = require("./routes/branches");
const conflicts_1 = require("./routes/conflicts");
const health_1 = require("./routes/health");
const logs_1 = require("./routes/logs");
const merge_1 = require("./routes/merge");
const settings_1 = require("./routes/settings");
const svn_1 = require("./routes/svn");
const system_1 = require("./routes/system");
const pathSafety_1 = require("./utils/pathSafety");
async function createApp() {
    await (0, store_1.initConfigStore)();
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '10mb' }));
    app.use('/api/health', health_1.healthRouter);
    app.use('/api/settings', settings_1.settingsRouter);
    app.post('/api/demo/reset', settings_1.resetDemoHandler);
    app.use('/api/branches', branches_1.branchesRouter);
    app.use('/api/svn', svn_1.svnRouter);
    app.use('/api/merge', merge_1.mergeRouter);
    app.use('/api/conflicts', conflicts_1.conflictsRouter);
    app.use('/api/system', system_1.systemRouter);
    app.use('/api/logs', logs_1.logsRouter);
    app.get('/api/history', (_req, res) => {
        res.json((0, store_1.getOperationHistory)());
    });
    // Static production frontend serving when client/dist exists
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
    // Unknown /api routes -> 404 JSON
    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'API endpoint not found.' });
    });
    // Error handler
    app.use((err, _req, res, _next) => {
        const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
        res.status(status).json({
            error: err.message || 'Internal server error',
        });
    });
    return app;
}
async function main() {
    const app = await createApp();
    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || 4100);
    app.listen(port, host, () => {
        const settings = (0, store_1.getSettings)();
        console.log(`[SVN Control Center] Server listening at http://${host}:${port} (mode=${settings.mode})`);
    });
}
if (require.main === module) {
    main().catch((err) => {
        console.error('[SVN Control Center] Fatal startup error:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map