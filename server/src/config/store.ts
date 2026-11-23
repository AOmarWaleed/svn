import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  AppSettings,
  EnvConfig,
  ModuleMapping,
  OperationHistoryEntry,
  PublicAppSettings,
  UpdateSettingsPayload,
} from '../../../shared/types';
import { getProjectRoot } from '../utils/pathSafety';
import {
  DEFAULT_ENVS,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_MODULES,
  DEFAULT_PROTECTED_PATTERNS,
} from './defaults';

interface PersistedConfig {
  settings: AppSettings;
  envs: EnvConfig[];
  modules: ModuleMapping[];
}

const MAX_HISTORY = 250;

const COMMON_WINDOWS_SVN_PATHS = [
  'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
  'C:\\Program Files (x86)\\TortoiseSVN\\bin\\svn.exe',
  'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
  'C:\\Program Files (x86)\\SlikSvn\\bin\\svn.exe',
  'C:\\Program Files\\VisualSVN Server\\bin\\svn.exe',
  'C:\\Program Files (x86)\\Subversion\\bin\\svn.exe',
];

export function getSampleRepoRoot(): string {
  return path.join(getProjectRoot(), 'sample-rcm');
}

function getDataDir(): string {
  return path.join(getProjectRoot(), 'server', 'data');
}

function getConfigPath(): string {
  return path.join(getDataDir(), 'config.json');
}

function getHistoryPath(): string {
  return path.join(getDataDir(), 'history.json');
}

let cachedConfig: PersistedConfig | null = null;
let cachedHistory: OperationHistoryEntry[] | null = null;
let detectedSvnPathsCache: string[] = [];

export function testSvnExecutable(
  svnPath: string
): Promise<{ available: boolean; version: string | null; error?: string }> {
  return new Promise((resolve) => {
    const trimmed = svnPath.trim() || 'svn';
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ available: false, version: null, error: 'Timed out running svn --version' });
    }, 4500);

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(trimmed, ['--version', '--quiet'], { windowsHide: true });
    } catch (err) {
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
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ available: false, version: null, error: err.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ available: true, version: stdout.trim() || 'unknown' });
      } else {
        resolve({
          available: false,
          version: null,
          error: stderr.trim() || `Exited with code ${code}`,
        });
      }
    });
  });
}

function runWhereSvn(): Promise<string[]> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    let out = '';
    try {
      const child = spawn(cmd, ['svn'], { windowsHide: true });
      child.stdout?.on('data', (c) => {
        out += String(c);
      });
      child.on('error', () => resolve([]));
      child.on('close', (code) => {
        if (code !== 0) {
          resolve([]);
          return;
        }
        resolve(
          out
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
        );
      });
    } catch {
      resolve([]);
    }
  });
}

export async function detectInstalledSvnPaths(): Promise<string[]> {
  const candidates = new Set<string>(await runWhereSvn());
  if (process.platform === 'win32') {
    for (const p of COMMON_WINDOWS_SVN_PATHS) {
      if (fs.existsSync(p)) candidates.add(p);
    }
  }
  const valid: string[] = [];
  for (const c of candidates) {
    const res = await testSvnExecutable(c);
    if (res.available) valid.push(c);
  }
  detectedSvnPathsCache = valid;
  return valid;
}

export function getCachedDetectedSvnPaths(): string[] {
  return [...detectedSvnPathsCache];
}

function defaultSettings(detectedSvn: string[]): AppSettings {
  const companyDefaultRoot = 'C:\\Users\\appdev3l\\Desktop\\rcm';
  const hasRealCompanyRepo = detectedSvn.length > 0 && fs.existsSync(companyDefaultRoot);
  return {
    mode: hasRealCompanyRepo ? 'real' : 'sample',
    repoRoot: companyDefaultRoot,
    svnPath: detectedSvn[0] ?? 'svn',
    editorCommand: 'code',
    authMode: 'cached',
    username: '',
    password: '',
    trustServerCert: true,
    ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
    protectedPatterns: [...DEFAULT_PROTECTED_PATTERNS],
  };
}

async function persistConfig(cfg: PersistedConfig): Promise<void> {
  await fsp.mkdir(getDataDir(), { recursive: true });
  await fsp.writeFile(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

async function persistHistory(entries: OperationHistoryEntry[]): Promise<void> {
  await fsp.mkdir(getDataDir(), { recursive: true });
  await fsp.writeFile(getHistoryPath(), JSON.stringify(entries, null, 2), 'utf8');
}

export async function initConfigStore(): Promise<void> {
  await fsp.mkdir(getDataDir(), { recursive: true });
  const detected = await detectInstalledSvnPaths();

  const cfgPath = getConfigPath();
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = await fsp.readFile(cfgPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedConfig>;
      cachedConfig = {
        settings: {
          ...defaultSettings(detected),
          ...(parsed.settings ?? {}),
        },
        envs:
          Array.isArray(parsed.envs) && parsed.envs.length > 0
            ? parsed.envs
            : DEFAULT_ENVS.map((e) => ({ ...e })),
        modules:
          Array.isArray(parsed.modules) && parsed.modules.length > 0
            ? parsed.modules
            : DEFAULT_MODULES.map((m) => ({ ...m, paths: { ...m.paths } })),
      };
    } catch {
      cachedConfig = {
        settings: defaultSettings(detected),
        envs: DEFAULT_ENVS.map((e) => ({ ...e })),
        modules: DEFAULT_MODULES.map((m) => ({ ...m, paths: { ...m.paths } })),
      };
      await persistConfig(cachedConfig);
    }
  } else {
    cachedConfig = {
      settings: defaultSettings(detected),
      envs: DEFAULT_ENVS.map((e) => ({ ...e })),
      modules: DEFAULT_MODULES.map((m) => ({ ...m, paths: { ...m.paths } })),
    };
    await persistConfig(cachedConfig);
  }

  const histPath = getHistoryPath();
  if (fs.existsSync(histPath)) {
    try {
      const raw = await fsp.readFile(histPath, 'utf8');
      const parsed = JSON.parse(raw);
      cachedHistory = Array.isArray(parsed) ? parsed : [];
    } catch {
      cachedHistory = [];
    }
  } else {
    cachedHistory = [];
    await persistHistory(cachedHistory);
  }
}

function ensureConfig(): PersistedConfig {
  if (!cachedConfig) {
    cachedConfig = {
      settings: defaultSettings(detectedSvnPathsCache),
      envs: DEFAULT_ENVS.map((e) => ({ ...e })),
      modules: DEFAULT_MODULES.map((m) => ({ ...m, paths: { ...m.paths } })),
    };
  }
  return cachedConfig;
}

export function getSettings(): AppSettings {
  return {
    ...ensureConfig().settings,
    ignorePatterns: [...ensureConfig().settings.ignorePatterns],
    protectedPatterns: [...ensureConfig().settings.protectedPatterns],
  };
}

export function getActiveRepoRoot(): string {
  const settings = ensureConfig().settings;
  return settings.mode === 'sample' ? getSampleRepoRoot() : settings.repoRoot;
}

export function getPublicSettings(): PublicAppSettings {
  const settings = getSettings();
  const { password, ...rest } = settings;
  return {
    ...rest,
    hasPassword: Boolean(password),
    activeRepoRoot: getActiveRepoRoot(),
    sampleRepoRoot: getSampleRepoRoot(),
  };
}

export async function updateSettings(
  payload: UpdateSettingsPayload
): Promise<PublicAppSettings> {
  const cfg = ensureConfig();
  const next: AppSettings = {
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
  } else if (typeof payload.password === 'string' && payload.password.length > 0) {
    next.password = payload.password;
  }

  cfg.settings = next;
  await persistConfig(cfg);
  return getPublicSettings();
}

export function getEnvs(): EnvConfig[] {
  return ensureConfig().envs.map((e) => ({ ...e }));
}

export function getEnvById(id: string): EnvConfig {
  const env = ensureConfig().envs.find((e) => e.id === id);
  if (!env) {
    throw Object.assign(new Error(`Environment not found: ${id}`), { statusCode: 404 });
  }
  return { ...env };
}

export function getModules(): ModuleMapping[] {
  return ensureConfig().modules.map((m) => ({ ...m, paths: { ...m.paths } }));
}

export function getModuleById(id: string): ModuleMapping {
  const mod = ensureConfig().modules.find((m) => m.id === id);
  if (!mod) {
    throw Object.assign(new Error(`Module not found: ${id}`), { statusCode: 404 });
  }
  return { ...mod, paths: { ...mod.paths } };
}

export async function addModule(input: {
  name: string;
  category?: string;
  paths: Record<string, string>;
}): Promise<ModuleMapping> {
  const cfg = ensureConfig();
  const baseSlug = input.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  let id = baseSlug || `mod-${randomUUID().slice(0, 6)}`;
  if (cfg.modules.some((m) => m.id === id)) {
    id = `${id}-${randomUUID().slice(0, 4)}`;
  }

  const created: ModuleMapping = {
    id,
    name: input.name.trim(),
    category: (input.category || 'Custom').trim(),
    paths: Object.fromEntries(
      Object.entries(input.paths).map(([k, v]) => [k, v.trim().replace(/^[/\\]+|[/\\]+$/g, '')])
    ),
  };

  cfg.modules.push(created);
  await persistConfig(cfg);
  return { ...created, paths: { ...created.paths } };
}

export async function updateModule(
  id: string,
  patch: Partial<Omit<ModuleMapping, 'id'>>
): Promise<ModuleMapping> {
  const cfg = ensureConfig();
  const idx = cfg.modules.findIndex((m) => m.id === id);
  if (idx === -1) {
    throw Object.assign(new Error(`Module not found: ${id}`), { statusCode: 404 });
  }

  const existing = cfg.modules[idx];
  const updated: ModuleMapping = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.category !== undefined ? { category: patch.category.trim() } : {}),
    ...(patch.paths !== undefined
      ? {
          paths: Object.fromEntries(
            Object.entries(patch.paths).map(([k, v]) => [
              k,
              v.trim().replace(/^[/\\]+|[/\\]+$/g, ''),
            ])
          ),
        }
      : {}),
  };

  cfg.modules[idx] = updated;
  await persistConfig(cfg);
  return { ...updated, paths: { ...updated.paths } };
}

export async function deleteModule(id: string): Promise<void> {
  const cfg = ensureConfig();
  const idx = cfg.modules.findIndex((m) => m.id === id);
  if (idx === -1) {
    throw Object.assign(new Error(`Module not found: ${id}`), { statusCode: 404 });
  }
  cfg.modules.splice(idx, 1);
  await persistConfig(cfg);
}

export function getOperationHistory(): OperationHistoryEntry[] {
  return [...(cachedHistory ?? [])];
}

export async function appendOperationHistory(
  entry: Omit<OperationHistoryEntry, 'id' | 'timestamp'>
): Promise<OperationHistoryEntry> {
  if (!cachedHistory) cachedHistory = [];
  const full: OperationHistoryEntry = {
    id: randomUUID(),
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
