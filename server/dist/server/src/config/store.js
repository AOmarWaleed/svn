"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSvnExecutable = testSvnExecutable;
exports.detectInstalledSvnPaths = detectInstalledSvnPaths;
exports.getCachedDetectedSvnPaths = getCachedDetectedSvnPaths;
exports.initConfigStore = initConfigStore;
exports.getSettings = getSettings;
exports.getPublicSettings = getPublicSettings;
exports.updateSettings = updateSettings;
exports.getRealBranches = getRealBranches;
exports.addRealBranch = addRealBranch;
exports.updateRealBranch = updateRealBranch;
exports.removeRealBranch = removeRealBranch;
exports.setRealMasterBranch = setRealMasterBranch;
exports.getOperationHistory = getOperationHistory;
exports.appendOperationHistory = appendOperationHistory;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const pathSafety_1 = require("../utils/pathSafety");
const MAX_HISTORY = 200;
const COMMON_WINDOWS_SVN_PATHS = [
    'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
    'C:\\Program Files (x86)\\TortoiseSVN\\bin\\svn.exe',
    'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
    'C:\\Program Files (x86)\\SlikSvn\\bin\\svn.exe',
    'C:\\Program Files\\VisualSVN Server\\bin\\svn.exe',
    'C:\\Program Files (x86)\\Subversion\\bin\\svn.exe',
    'C:\\Program Files\\CollabNet\\Subversion Client\\svn.exe',
];
function getDataDir() {
    return node_path_1.default.join((0, pathSafety_1.getProjectRoot)(), 'server', 'data');
}
function getConfigPath() {
    return node_path_1.default.join(getDataDir(), 'config.json');
}
function getHistoryPath() {
    return node_path_1.default.join(getDataDir(), 'history.json');
}
let cachedConfig = null;
let cachedHistory = null;
let detectedSvnPathsCache = [];
function testSvnExecutable(svnPath) {
    return new Promise((resolve) => {
        const trimmed = svnPath.trim() || 'svn';
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            try {
                child.kill();
            }
            catch {
                // ignore
            }
            resolve({ available: false, version: null, error: 'Timed out running svn --version' });
        }, 4500);
        let child;
        try {
            child = (0, node_child_process_1.spawn)(trimmed, ['--version', '--quiet'], {
                windowsHide: true,
            });
        }
        catch (err) {
            clearTimeout(timer);
            resolve({
                available: false,
                version: null,
                error: err instanceof Error ? err.message : String(err),
            });
            return;
        }
        child.stdout?.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk) => {
            stderr += String(chunk);
        });
        child.on('error', (err) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ available: false, version: null, error: err.message });
        });
        child.on('close', (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) {
                const version = stdout.trim() || 'unknown';
                resolve({ available: true, version });
            }
            else {
                resolve({
                    available: false,
                    version: null,
                    error: stderr.trim() || `Exited with code ${code}`,
                });
            }
        });
    });
}
function runWhereSvn() {
    return new Promise((resolve) => {
        const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
        let stdout = '';
        try {
            const child = (0, node_child_process_1.spawn)(cmd, ['svn'], { windowsHide: true });
            child.stdout?.on('data', (c) => {
                stdout += String(c);
            });
            child.on('error', () => resolve([]));
            child.on('close', (code) => {
                if (code !== 0) {
                    resolve([]);
                    return;
                }
                const lines = stdout
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean);
                resolve(lines);
            });
        }
        catch {
            resolve([]);
        }
    });
}
async function detectInstalledSvnPaths() {
    const candidates = new Set();
    const fromPath = await runWhereSvn();
    for (const p of fromPath)
        candidates.add(p);
    if (process.platform === 'win32') {
        for (const p of COMMON_WINDOWS_SVN_PATHS) {
            if (node_fs_1.default.existsSync(p)) {
                candidates.add(p);
            }
        }
    }
    const valid = [];
    for (const candidate of candidates) {
        const res = await testSvnExecutable(candidate);
        if (res.available) {
            valid.push(candidate);
        }
    }
    detectedSvnPathsCache = valid;
    return valid;
}
function getCachedDetectedSvnPaths() {
    return [...detectedSvnPathsCache];
}
function defaultSettings(detectedPaths) {
    const svnAvailable = detectedPaths.length > 0;
    return {
        mode: svnAvailable ? 'real' : 'demo',
        svnPath: detectedPaths[0] ?? 'svn',
        editorCommand: 'code',
        authMode: 'cached',
        username: '',
        password: '',
        trustServerCert: true,
        autoUpdateBeforeMerge: false,
        defaultScanRoot: process.platform === 'win32' ? 'D:\\CompanySVN' : '/var/svn',
    };
}
async function persistConfig(config) {
    await promises_1.default.mkdir(getDataDir(), { recursive: true });
    await promises_1.default.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}
async function persistHistory(entries) {
    await promises_1.default.mkdir(getDataDir(), { recursive: true });
    await promises_1.default.writeFile(getHistoryPath(), JSON.stringify(entries, null, 2), 'utf8');
}
async function initConfigStore() {
    await promises_1.default.mkdir(getDataDir(), { recursive: true });
    const detected = await detectInstalledSvnPaths();
    const cfgPath = getConfigPath();
    if (node_fs_1.default.existsSync(cfgPath)) {
        try {
            const raw = await promises_1.default.readFile(cfgPath, 'utf8');
            const parsed = JSON.parse(raw);
            cachedConfig = {
                settings: {
                    ...defaultSettings(detected),
                    ...(parsed.settings ?? {}),
                },
                branches: Array.isArray(parsed.branches) ? parsed.branches : [],
            };
        }
        catch {
            cachedConfig = {
                settings: defaultSettings(detected),
                branches: [],
            };
            await persistConfig(cachedConfig);
        }
    }
    else {
        cachedConfig = {
            settings: defaultSettings(detected),
            branches: [],
        };
        await persistConfig(cachedConfig);
    }
    const histPath = getHistoryPath();
    if (node_fs_1.default.existsSync(histPath)) {
        try {
            const raw = await promises_1.default.readFile(histPath, 'utf8');
            const parsed = JSON.parse(raw);
            cachedHistory = Array.isArray(parsed) ? parsed : [];
        }
        catch {
            cachedHistory = [];
        }
    }
    else {
        cachedHistory = [];
        await persistHistory(cachedHistory);
    }
}
function ensureConfig() {
    if (!cachedConfig) {
        cachedConfig = {
            settings: defaultSettings(detectedSvnPathsCache),
            branches: [],
        };
    }
    return cachedConfig;
}
function getSettings() {
    return { ...ensureConfig().settings };
}
function getPublicSettings() {
    const { password, ...rest } = getSettings();
    return {
        ...rest,
        hasPassword: Boolean(password),
    };
}
async function updateSettings(payload) {
    const cfg = ensureConfig();
    const next = {
        ...cfg.settings,
        ...(payload.mode !== undefined ? { mode: payload.mode } : {}),
        ...(payload.svnPath !== undefined ? { svnPath: payload.svnPath.trim() || 'svn' } : {}),
        ...(payload.editorCommand !== undefined ? { editorCommand: payload.editorCommand.trim() || 'default' } : {}),
        ...(payload.authMode !== undefined ? { authMode: payload.authMode } : {}),
        ...(payload.username !== undefined ? { username: payload.username } : {}),
        ...(payload.trustServerCert !== undefined ? { trustServerCert: payload.trustServerCert } : {}),
        ...(payload.autoUpdateBeforeMerge !== undefined
            ? { autoUpdateBeforeMerge: payload.autoUpdateBeforeMerge }
            : {}),
        ...(payload.defaultScanRoot !== undefined ? { defaultScanRoot: payload.defaultScanRoot.trim() } : {}),
    };
    if (payload.clearPassword) {
        next.password = '';
    }
    else if (typeof payload.password === 'string' && payload.password.length > 0) {
        next.password = payload.password;
    }
    cfg.settings = next;
    await persistConfig(cfg);
    return getPublicSettings();
}
function getRealBranches() {
    return ensureConfig().branches.map((b) => ({ ...b }));
}
async function addRealBranch(input) {
    const cfg = ensureConfig();
    const normalizedPath = node_path_1.default.resolve(input.path.trim());
    const duplicate = cfg.branches.find((b) => process.platform === 'win32'
        ? node_path_1.default.resolve(b.path).toLowerCase() === normalizedPath.toLowerCase()
        : node_path_1.default.resolve(b.path) === normalizedPath);
    if (duplicate) {
        throw Object.assign(new Error(`Branch path already added: ${normalizedPath}`), { statusCode: 409 });
    }
    const isMaster = Boolean(input.isMaster) || cfg.branches.length === 0;
    if (isMaster) {
        cfg.branches = cfg.branches.map((b) => ({ ...b, isMaster: false }));
    }
    const branch = {
        id: (0, node_crypto_1.randomUUID)(),
        name: input.name.trim() || node_path_1.default.basename(normalizedPath),
        path: normalizedPath,
        isMaster,
        color: input.color,
    };
    cfg.branches.push(branch);
    await persistConfig(cfg);
    return { ...branch };
}
async function updateRealBranch(id, patch) {
    const cfg = ensureConfig();
    const idx = cfg.branches.findIndex((b) => b.id === id);
    if (idx === -1) {
        throw Object.assign(new Error(`Branch not found: ${id}`), { statusCode: 404 });
    }
    if (patch.isMaster) {
        cfg.branches = cfg.branches.map((b) => ({ ...b, isMaster: b.id === id }));
    }
    const existing = cfg.branches[idx];
    const updated = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.path !== undefined ? { path: node_path_1.default.resolve(patch.path.trim()) } : {}),
        ...(patch.isMaster !== undefined ? { isMaster: patch.isMaster } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
    };
    cfg.branches[idx] = updated;
    await persistConfig(cfg);
    return { ...updated };
}
async function removeRealBranch(id) {
    const cfg = ensureConfig();
    const idx = cfg.branches.findIndex((b) => b.id === id);
    if (idx === -1) {
        throw Object.assign(new Error(`Branch not found: ${id}`), { statusCode: 404 });
    }
    const wasMaster = cfg.branches[idx].isMaster;
    cfg.branches.splice(idx, 1);
    if (wasMaster && cfg.branches.length > 0) {
        cfg.branches[0].isMaster = true;
    }
    await persistConfig(cfg);
}
async function setRealMasterBranch(id) {
    const cfg = ensureConfig();
    const exists = cfg.branches.some((b) => b.id === id);
    if (!exists) {
        throw Object.assign(new Error(`Branch not found: ${id}`), { statusCode: 404 });
    }
    cfg.branches = cfg.branches.map((b) => ({ ...b, isMaster: b.id === id }));
    await persistConfig(cfg);
    return getRealBranches();
}
function getOperationHistory() {
    return [...(cachedHistory ?? [])];
}
async function appendOperationHistory(entry) {
    if (!cachedHistory)
        cachedHistory = [];
    const full = {
        id: (0, node_crypto_1.randomUUID)(),
        timestamp: new Date().toISOString(),
        ...entry,
    };
    cachedHistory.unshift(full);
    if (cachedHistory.length > MAX_HISTORY) {
        cachedHistory.length = MAX_HISTORY;
    }
    await persistHistory(cachedHistory);
    return full;
}
//# sourceMappingURL=store.js.map