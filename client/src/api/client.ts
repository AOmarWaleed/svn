import type {
  ActiveConflictItem,
  CommandLogEntry,
  DiscoveredFolder,
  HealthInfo,
  LogEntry,
  ModuleApplyPlan,
  ModuleEligibleInfo,
  ModuleMapping,
  OperationHistoryEntry,
  PublicAppSettings,
  RepoOverview,
  TransferApplyResponse,
  TransferEngine,
  TransferPreviewResponse,
  UpdateSettingsPayload,
} from '../../../shared/types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const errMsg =
      (data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) || `${res.status} ${res.statusText}`;
    throw new Error(errMsg);
  }

  return data as T;
}

export const api = {
  getHealth: () => requestJson<HealthInfo>('/api/health'),

  getSettings: () => requestJson<PublicAppSettings>('/api/settings'),
  updateSettings: (payload: UpdateSettingsPayload) =>
    requestJson<PublicAppSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  testSvn: (svnPath: string) =>
    requestJson<{
      available: boolean;
      version: string | null;
      error?: string;
      detectedSvnPaths: string[];
    }>('/api/settings/test-svn', {
      method: 'POST',
      body: JSON.stringify({ svnPath }),
    }),
  testVsCode: () =>
    requestJson<{ available: boolean; vscodePath: string | null }>(
      '/api/settings/test-vscode',
      { method: 'POST' }
    ),
  resetSampleRepo: () =>
    requestJson<{ ok: boolean; sampleRepoRoot: string }>('/api/sample/reset', {
      method: 'POST',
    }),

  getOverview: () => requestJson<RepoOverview>('/api/overview'),

  getModules: () => requestJson<ModuleMapping[]>('/api/modules'),
  addModule: (payload: { name: string; category?: string; paths: Record<string, string> }) =>
    requestJson<ModuleMapping>('/api/modules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateModule: (id: string, payload: Partial<Omit<ModuleMapping, 'id'>>) =>
    requestJson<ModuleMapping>(`/api/modules/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteModule: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/modules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  discoverFolders: () =>
    requestJson<DiscoveredFolder[]>('/api/modules/discover', { method: 'POST' }),

  updateModuleEnv: (moduleId: string, envId: string) =>
    requestJson<{ output: string }>(
      `/api/module/${encodeURIComponent(moduleId)}/${encodeURIComponent(envId)}/update`,
      { method: 'POST' }
    ),
  commitModuleEnv: (moduleId: string, envId: string, files: string[], message: string) =>
    requestJson<{ output: string; newRevision?: number }>(
      `/api/module/${encodeURIComponent(moduleId)}/${encodeURIComponent(envId)}/commit`,
      {
        method: 'POST',
        body: JSON.stringify({ files, message }),
      }
    ),
  revertModuleEnv: (moduleId: string, envId: string, files?: string[]) =>
    requestJson<{ output: string }>(
      `/api/module/${encodeURIComponent(moduleId)}/${encodeURIComponent(envId)}/revert`,
      {
        method: 'POST',
        body: JSON.stringify({ files }),
      }
    ),
  getModuleDiff: (moduleId: string, envId: string, file?: string) =>
    requestJson<{ diff: string }>(
      `/api/module/${encodeURIComponent(moduleId)}/${encodeURIComponent(envId)}/diff${
        file ? `?file=${encodeURIComponent(file)}` : ''
      }`
    ),
  getModuleLog: (moduleId: string, envId: string, limit = 30) =>
    requestJson<LogEntry[]>(
      `/api/module/${encodeURIComponent(moduleId)}/${encodeURIComponent(envId)}/log?limit=${limit}`
    ),

  getEligibleRevisions: (sourceEnvId: string, targetEnvId: string, moduleIds: string[]) =>
    requestJson<ModuleEligibleInfo[]>('/api/transfer/eligible', {
      method: 'POST',
      body: JSON.stringify({ sourceEnvId, targetEnvId, moduleIds }),
    }),
  previewTransfer: (payload: {
    engine: TransferEngine;
    sourceEnvId: string;
    targetEnvId: string;
    moduleIds: string[];
    ignoreAncestry?: boolean;
    revisionsByModule?: Record<string, number[]>;
  }) =>
    requestJson<TransferPreviewResponse>('/api/transfer/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  applyTransfer: (payload: {
    engine: TransferEngine;
    sourceEnvId: string;
    targetEnvId: string;
    moduleIds: string[];
    modulePlans?: ModuleApplyPlan[];
    ignoreAncestry?: boolean;
    revisionsByModule?: Record<string, number[]>;
  }) =>
    requestJson<TransferApplyResponse>('/api/transfer/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  rollbackTransfer: (payload: {
    rollbackId?: string;
    targetEnvId?: string;
    moduleIds?: string[];
  }) =>
    requestJson<{ ok: boolean; restoredCount?: number }>('/api/transfer/rollback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getConflicts: () => requestJson<ActiveConflictItem[]>('/api/conflicts'),
  resolveConflict: (conflictId: string, strategy: 'working' | 'source' | 'target') =>
    requestJson<{ output: string }>('/api/conflicts/resolve', {
      method: 'POST',
      body: JSON.stringify({ conflictId, strategy }),
    }),
  openConflictInVsCode: (conflictId: string, mode: 'file' | 'diff') =>
    requestJson<{ ok: boolean; launched: string; mode: string; target: string }>(
      '/api/conflicts/open-vscode',
      {
        method: 'POST',
        body: JSON.stringify({ conflictId, mode }),
      }
    ),
  openAllConflictsInVsCode: (filter?: { targetEnvId?: string; moduleId?: string }) =>
    requestJson<{ ok: boolean; count: number; launched: string }>(
      '/api/conflicts/open-all-vscode',
      {
        method: 'POST',
        body: JSON.stringify(filter ?? {}),
      }
    ),

  openFolder: (moduleId?: string, envId?: string) =>
    requestJson<{ ok: boolean; path: string }>('/api/system/open-folder', {
      method: 'POST',
      body: JSON.stringify({ moduleId, envId }),
    }),
  openVsCodeFolder: (moduleId?: string, envId?: string) =>
    requestJson<{ ok: boolean; path: string }>('/api/system/open-vscode-folder', {
      method: 'POST',
      body: JSON.stringify({ moduleId, envId }),
    }),

  getLogs: () => requestJson<CommandLogEntry[]>('/api/logs'),
  clearLogs: () => requestJson<{ ok: boolean }>('/api/logs', { method: 'DELETE' }),
  getHistory: () => requestJson<OperationHistoryEntry[]>('/api/history'),
};
