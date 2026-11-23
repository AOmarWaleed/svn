"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactArgs = redactArgs;
exports.formatCommandLine = formatCommandLine;
exports.startCommandLog = startCommandLog;
exports.appendCommandOutput = appendCommandOutput;
exports.finishCommandLog = finishCommandLog;
exports.recordInstantCommandLog = recordInstantCommandLog;
exports.getCommandLogs = getCommandLogs;
exports.clearCommandLogs = clearCommandLogs;
exports.subscribeCommandLogsSse = subscribeCommandLogsSse;
const node_crypto_1 = require("node:crypto");
const MAX_LOGS = 500;
const logs = [];
const sseClients = new Set();
/**
 * Redacts passwords from CLI argument arrays before logging.
 */
function redactArgs(args) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--password' && i + 1 < args.length) {
            out.push('--password', '***');
            i++;
        }
        else if (arg.startsWith('--password=')) {
            out.push('--password=***');
        }
        else {
            out.push(arg);
        }
    }
    return out;
}
function formatCommandLine(executable, args) {
    const safeArgs = redactArgs(args).map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
    const exeName = executable.includes('\\') || executable.includes('/') ? `"${executable}"` : executable;
    return `${exeName} ${safeArgs.join(' ')}`.trim();
}
function broadcastLog(entry) {
    const payload = `event: log\ndata: ${JSON.stringify(entry)}\n\n`;
    for (const res of sseClients) {
        try {
            res.write(payload);
        }
        catch {
            sseClients.delete(res);
        }
    }
}
function pushEntry(entry) {
    logs.push(entry);
    if (logs.length > MAX_LOGS) {
        logs.splice(0, logs.length - MAX_LOGS);
    }
    broadcastLog(entry);
}
function startCommandLog(opts) {
    const id = (0, node_crypto_1.randomUUID)();
    const entry = {
        id,
        timestamp: new Date().toISOString(),
        branchId: opts.branchId,
        branchName: opts.branchName,
        command: opts.command,
        status: 'running',
        output: '',
    };
    pushEntry(entry);
    return id;
}
function appendCommandOutput(id, chunk) {
    const entry = logs.find((item) => item.id === id);
    if (!entry)
        return;
    entry.output += chunk;
    if (entry.output.length > 50_000) {
        entry.output = entry.output.slice(-50_000);
    }
    broadcastLog({ ...entry });
}
function finishCommandLog(id, status, durationMs, extraOutput) {
    const entry = logs.find((item) => item.id === id);
    if (!entry)
        return;
    if (extraOutput) {
        entry.output = entry.output ? `${entry.output}\n${extraOutput}` : extraOutput;
    }
    entry.status = status;
    entry.durationMs = durationMs;
    broadcastLog({ ...entry });
}
function recordInstantCommandLog(opts) {
    const entry = {
        id: (0, node_crypto_1.randomUUID)(),
        timestamp: new Date().toISOString(),
        branchId: opts.branchId,
        branchName: opts.branchName,
        command: opts.command,
        status: opts.status,
        output: opts.output,
        durationMs: opts.durationMs,
    };
    pushEntry(entry);
    return entry;
}
function getCommandLogs() {
    return [...logs];
}
function clearCommandLogs() {
    logs.length = 0;
    const payload = `event: clear\ndata: {}\n\n`;
    for (const res of sseClients) {
        try {
            res.write(payload);
        }
        catch {
            sseClients.delete(res);
        }
    }
}
function subscribeCommandLogsSse(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    sseClients.add(res);
    // Send initial snapshot of recent logs
    res.write(`event: snapshot\ndata: ${JSON.stringify(logs.slice(-100))}\n\n`);
    const heartbeat = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        }
        catch {
            clearInterval(heartbeat);
            sseClients.delete(res);
        }
    }, 25_000);
    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
    });
}
//# sourceMappingURL=commandLogger.js.map