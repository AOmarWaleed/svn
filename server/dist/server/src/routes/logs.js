"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logsRouter = void 0;
const express_1 = require("express");
const commandLogger_1 = require("../utils/commandLogger");
exports.logsRouter = (0, express_1.Router)();
exports.logsRouter.get('/', (_req, res) => {
    res.json((0, commandLogger_1.getCommandLogs)());
});
exports.logsRouter.get('/stream', (req, res) => {
    (0, commandLogger_1.subscribeCommandLogsSse)(req, res);
});
exports.logsRouter.delete('/', (_req, res) => {
    (0, commandLogger_1.clearCommandLogs)();
    res.json({ ok: true });
});
//# sourceMappingURL=logs.js.map