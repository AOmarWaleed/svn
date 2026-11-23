"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSampleRepoRoot = getSampleRepoRoot;
exports.testSvnExecutable = testSvnExecutable;
exports.detectInstalledSvnPaths = detectInstalledSvnPaths;
exports.getCachedDetectedSvnPaths = getCachedDetectedSvnPaths;
exports.initConfigStore = initConfigStore;
exports.getSettings = getSettings;
exports.getActiveRepoRoot = getActiveRepoRoot;
exports.getPublicSettings = getPublicSettings;
exports.updateSettings = updateSettings;
exports.getEnvs = getEnvs;
exports.getEnvById = getEnvById;
exports.getModules = getModules;
exports.getModuleById = getModuleById;
exports.addModule = addModule;
exports.updateModule = updateModule;
exports.deleteModule = deleteModule;
exports.getOperationHistory = getOperationHistory;
exports.appendOperationHistory = appendOperationHistory;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const pathSafety_1 = require("../utils/pathSafety");
const defaults_1 = require("./defaults");
const MAX_HISTORY = 250;
const COMMON_WINDOWS_SVN_PATHS = [
    'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
    'C:\\Program Files (x86)\\TortoiseSVN\\bin\\svn.exe',
    'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
    'C:\\Program Files (x86)\\SlikSvn\\bin\\svn.exe',
    'C:\\Program Files\\VisualSVN Server\\bin\\svn.exe',
    'C:\\Program Files (x86)\\Subversion\\bin\\svn.exe',
];
function getSampleRepoRoot() {
    return node_path_1.default.join((0, pathSafety_1.getProjectRoot)(), 'sample-rcm');
}
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
            child = (0, node_child_process_1.spawn)(trimmed, ['--version', '--quiet'], { windowsHide: true });
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
        child.stdout?.on('data', (c) => {
            stdout += String(c);
        });
        child.stderr?.on('data', (c) => {
            stderr += String(c);
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
                resolve({ available: true, version: stdout.trim() || 'unknown' });
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
        let out = '';
        try {
            const child = (0, node_child_process_1.spawn)(cmd, ['svn'], { windowsHide: true });
            child.stdout?.on('data', (c) => {
                out += String(c);
            });
            child.on('error', () => resolve([]));
            child.on('close', (code) => {
                if (code !== 0) {
                    resolve([]);
                    return;
                }
                resolve(out
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean));
            });
        }
        catch {
            resolve([]);
        }
    });
}
async function detectInstalledSvnPaths() {
    const candidates = new Set(await runWhereSvn());
    if (process.platform === 'win32') {
        for (const p of COMMON_WINDOWS_SVN_PATHS) {
            if (node_fs_1.default.existsSync(p))
                candidates.add(p);
        }
    }
    const valid = [];
    for (const c of candidates) {
        const res = await testSvnExecutable(c);
        if (res.available)
            valid.push(c);
    }
    detectedSvnPathsCache = valid;
    return valid;
}
function getCachedDetectedSvnPaths() {
    return [...detectedSvnPathsCache];
}
function defaultSettings(detectedSvn) {
    const companyDefaultRoot = 'C:\\Users\\appdev3l\\Desktop\\rcm';
    const hasRealCompanyRepo = detectedSvn.length > 0 && node_fs_1.default.existsSync(companyDefaultRoot);
    return {
        mode: hasRealCompanyRepo ? 'real' : 'sample',
        repoRoot: companyDefaultRoot,
        svnPath: detectedSvn[0] ?? 'svn',
        editorCommand: 'code',
        authMode: 'cached',
        username: '',
        password: '',
        trustServerCert: true,
        ignorePatterns: [...defaults_1.DEFAULT_IGNORE_PATTERNS],
        protectedPatterns: [...defaults_1.DEFAULT_PROTECTED_PATTERNS],
    };
}
async function persistConfig(cfg) {
    await promises_1.default.mkdir(getDataDir(), { recursive: true });
    await promises_1.default.writeFile(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
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
                envs: Array.isArray(parsed.envs) && parsed.envs.length > 0
                    ? parsed.envs
                    : defaults_1.DEFAULT_ENVS.map((e) => ({ ...e })),
                modules: Array.isArray(parsed.modules) && parsed.modules.length > 0
                    ? parsed.modules
                    : defaults_1.DEFAULT_MODULES.map((m) => ({ ...m, paths: { ...m.paths } })),
            };
        }
        catch {
            cachedConfig = {
                settings: defaultSettings(detected),
                envs: defaults_1.DEFAULT_ENVS.map((e) => ({ ...e })),
                modules: defaults_1.DEFAULT_MODULES.map((m) => ({ ...m, paths: { ...m.paths } })),
            };
            await persistConfig(cachedConfig);
        }
    }
    else {
        cachedConfig = {
            settings: defaultSettings(detected),
            envs: defaults_1.DEFAULT_ENVS.map((e) => ({ ...e })),
            modules: defaults_1.DEFAULT_MODULES.map((m) => ({ ...m, paths: { ...m.paths } })),
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
            envs: defaults_1.DEFAULT_ENVS.map((e) => ({ ...e })),
            modules: defaults_1.DEFAULT_MODULES.map((m) => ({ ...m, paths: { ...m.paths } })),
        };
    }
    return cachedConfig;
}
function getSettings() {
    return {
        ...ensureConfig().settings,
        ignorePatterns: [...ensureConfig().settings.ignorePatterns],
        protectedPatterns: [...ensureConfig().settings.protectedPatterns],
    };
}
function getActiveRepoRoot() {
    const settings = ensureConfig().settings;
    return settings.mode === 'sample' ? getSampleRepoRoot() : settings.repoRoot;
}
function getPublicSettings() {
    const settings = getSettings();
    const { password, ...rest } = settings;
    return {
        ...rest,
        hasPassword: Boolean(password),
        activeRepoRoot: getActiveRepoRoot(),
        sampleRepoRoot: getSampleRepoRoot(),
    };
}
async function updateSettings(payload) {
    const cfg = ensureConfig();
    const next = {
        ...cfg.settings,
        ...(payload.mode !== undefined ? { mode: payload.mode } : {}),
        ...(payload.repoRoot !== undefined ? { repoRoot: payload.repoRoot.trim() } : {}),
        ...(payload.svnPath !== undefined ? { svnPath: payload.svnPath.trim() || 'svn' } : {}),
        ...(payload.editorCommand !== undefined
            ? { editorCommand: payload.editorCommand.trim() || 'code' }
            : {}),
        ...(payload.authMode !== undefined ? { authMode: payload.authMode } : {}),
        ...(payload.username !== undefined ? { username: payload.username } : {}),
        ...(payload.trustServerCert !== undefined
            ? { trustServerCert: payload.trustServerCert }
            : {}),
        ...(Array.isArray(payload.ignorePatterns)
            ? { ignorePatterns: payload.ignorePatterns.map((p) => p.trim()).filter(Boolean) }
            : {}),
        ...(Array.isArray(payload.protectedPatterns)
            ? { protectedPatterns: payload.protectedPatterns.map((p) => p.trim()).filter(Boolean) }
            : {}),
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
function getEnvs() {
    return ensureConfig().envs.map((e) => ({ ...e }));
}
function getEnvById(id) {
    const env = ensureConfig().envs.find((e) => e.id === id);
    if (!env) {
        throw Object.assign(new Error(`Environment not found: ${id}`), { statusCode: 404 });
    }
    return { ...env };
}
function getModules() {
    return ensureConfig().modules.map((m) => ({ ...m, paths: { ...m.paths } }));
}
function getModuleById(id) {
    const mod = ensureConfig().modules.find((m) => m.id === id);
    if (!mod) {
        throw Object.assign(new Error(`Module not found: ${id}`), { statusCode: 404 });
    }
    return { ...mod, paths: { ...mod.paths } };
}
async function addModule(input) {
    const cfg = ensureConfig();
    const baseSlug = input.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    let id = baseSlug || `mod-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`;
    if (cfg.modules.some((m) => m.id === id)) {
        id = `${id}-${(0, node_crypto_1.randomUUID)().slice(0, 4)}`;
    }
    const created = {
        id,
        name: input.name.trim(),
        category: (input.category || 'Custom').trim(),
        paths: Object.fromEntries(Object.entries(input.paths).map(([k, v]) => [k, v.trim().replace(/^[/\\]+|[/\\]+$/g, '')])),
    };
    cfg.modules.push(created);
    await persistConfig(cfg);
    return { ...created, paths: { ...created.paths } };
}
async function updateModule(id, patch) {
    const cfg = ensureConfig();
    const idx = cfg.modules.findIndex((m) => m.id === id);
    if (idx === -1) {
        throw Object.assign(new Error(`Module not found: ${id}`), { statusCode: 404 });
    }
    const existing = cfg.modules[idx];
    const updated = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.category !== undefined ? { category: patch.category.trim() } : {}),
        ...(patch.paths !== undefined
            ? {
                paths: Object.fromEntries(Object.entries(patch.paths).map(([k, v]) => [
                    k,
                    v.trim().replace(/^[/\\]+|[/\\]+$/g, ''),
                ])),
            }
            : {}),
    };
    cfg.modules[idx] = updated;
    await persistConfig(cfg);
    return { ...updated, paths: { ...updated.paths } };
}
async function deleteModule(id) {
    const cfg = ensureConfig();
    const idx = cfg.modules.findIndex((m) => m.id === id);
    if (idx === -1) {
        throw Object.assign(new Error(`Module not found: ${id}`), { statusCode: 404 });
    }
    cfg.modules.splice(idx, 1);
    await persistConfig(cfg);
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