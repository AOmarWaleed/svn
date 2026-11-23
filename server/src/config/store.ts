import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  AppSettings,
  BranchConfig,
  OperationHistoryEntry,
  PublicAppSettings,
  UpdateSettingsPayload,
} from '../../../shared/types';
import { getProjectRoot } from '../utils/pathSafety';

interface PersistedConfig {
  settings: AppSettings;
  branches: BranchConfig[];
}

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
      child = spawn(trimmed, ['--version', '--quiet'], {
        windowsHide: true,
      });
    } catch (err) {
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
        const version = stdout.trim() || 'unknown';
        resolve({ available: true, version });
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
    let stdout = '';
    try {
      const child = spawn(cmd, ['svn'], { windowsHide: true });
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
    } catch {
      resolve([]);
    }
  });
}

export async function detectInstalledSvnPaths(): Promise<string[]> {
  const candidates = new Set<string>();
  const fromPath = await runWhereSvn();
  for (const p of fromPath) candidates.add(p);

  if (process.platform === 'win32') {
    for (const p of COMMON_WINDOWS_SVN_PATHS) {
      if (fs.existsSync(p)) {
        candidates.add(p);
      }
    }
  }

  const valid: string[] = [];
  for (const candidate of candidates) {
    const res = await testSvnExecutable(candidate);
    if (res.available) {
      valid.push(candidate);
    }
  }

  detectedSvnPathsCache = valid;
  return valid;
}

export function getCachedDetectedSvnPaths(): string[] {
  return [...detectedSvnPathsCache];
}

function defaultSettings(detectedPaths: string[]): AppSettings {
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

async function persistConfig(config: PersistedConfig): Promise<void> {
  await fsp.mkdir(getDataDir(), { recursive: true });
  await fsp.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
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
        branches: Array.isArray(parsed.branches) ? parsed.branches : [],
      };
    } catch {
      cachedConfig = {
        settings: defaultSettings(detected),
        branches: [],
      };
      await persistConfig(cachedConfig);
    }
  } else {
    cachedConfig = {
      settings: defaultSettings(detected),
      branches: [],
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
      branches: [],
    };
  }
  return cachedConfig;
}

export function getSettings(): AppSettings {
  return { ...ensureConfig().settings };
}

export function getPublicSettings(): PublicAppSettings {
  const { password, ...rest } = getSettings();
  return {
    ...rest,
    hasPassword: Boolean(password),
  };
}

export async function updateSettings(payload: UpdateSettingsPayload): Promise<PublicAppSettings> {
  const cfg = ensureConfig();
  const next: AppSettings = {
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
  } else if (typeof payload.password === 'string' && payload.password.length > 0) {
    next.password = payload.password;
  }

  cfg.settings = next;
  await persistConfig(cfg);
  return getPublicSettings();
}

export function getRealBranches(): BranchConfig[] {
  return ensureConfig().branches.map((b) => ({ ...b }));
}

export async function addRealBranch(input: {
  name: string;
  path: string;
  isMaster?: boolean;
  color?: string;
}): Promise<BranchConfig> {
  const cfg = ensureConfig();
  const normalizedPath = path.resolve(input.path.trim());
  const duplicate = cfg.branches.find((b) =>
    process.platform === 'win32'
      ? path.resolve(b.path).toLowerCase() === normalizedPath.toLowerCase()
      : path.resolve(b.path) === normalizedPath
  );
  if (duplicate) {
    throw Object.assign(new Error(`Branch path already added: ${normalizedPath}`), { statusCode: 409 });
  }

  const isMaster = Boolean(input.isMaster) || cfg.branches.length === 0;
  if (isMaster) {
    cfg.branches = cfg.branches.map((b) => ({ ...b, isMaster: false }));
  }

  const branch: BranchConfig = {
    id: randomUUID(),
    name: input.name.trim() || path.basename(normalizedPath),
    path: normalizedPath,
    isMaster,
    color: input.color,
  };

  cfg.branches.push(branch);
  await persistConfig(cfg);
  return { ...branch };
}

export async function updateRealBranch(
  id: string,
  patch: Partial<Omit<BranchConfig, 'id'>>
): Promise<BranchConfig> {
  const cfg = ensureConfig();
  const idx = cfg.branches.findIndex((b) => b.id === id);
  if (idx === -1) {
    throw Object.assign(new Error(`Branch not found: ${id}`), { statusCode: 404 });
  }

  if (patch.isMaster) {
    cfg.branches = cfg.branches.map((b) => ({ ...b, isMaster: b.id === id }));
  }

  const existing = cfg.branches[idx];
  const updated: BranchConfig = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.path !== undefined ? { path: path.resolve(patch.path.trim()) } : {}),
    ...(patch.isMaster !== undefined ? { isMaster: patch.isMaster } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
  };

  cfg.branches[idx] = updated;
  await persistConfig(cfg);
  return { ...updated };
}

export async function removeRealBranch(id: string): Promise<void> {
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

export async function setRealMasterBranch(id: string): Promise<BranchConfig[]> {
  const cfg = ensureConfig();
  const exists = cfg.branches.some((b) => b.id === id);
  if (!exists) {
    throw Object.assign(new Error(`Branch not found: ${id}`), { statusCode: 404 });
  }
  cfg.branches = cfg.branches.map((b) => ({ ...b, isMaster: b.id === id }));
  await persistConfig(cfg);
  return getRealBranches();
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
