import type {
  BranchConfig,
  BranchStatus,
  CommandLogEntry,
  ConflictFileDetail,
  ConflictListItem,
  ConflictQuickStrategy,
  HealthInfo,
  LogEntry,
  MergeExecuteResult,
  MergeMode,
  MergePreviewResult,
  OperationHistoryEntry,
  PreflightResult,
  PublicAppSettings,
  ScannedWorkingCopy,
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
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
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
  testSvnPath: (svnPath: string) =>
    requestJson<{
      available: boolean;
      version: string | null;
      error?: string;
      detectedSvnPaths: string[];
    }>('/api/settings/test-svn', {
      method: 'POST',
      body: JSON.stringify({ svnPath }),
    }),
  resetDemo: () =>
    requestJson<{ ok: boolean }>('/api/demo/reset', {
      method: 'POST',
    }),

  getBranches: () => requestJson<BranchConfig[]>('/api/branches'),
  addBranch: (payload: { name: string; path: string; isMaster?: boolean; color?: string }) =>
    requestJson<BranchConfig>('/api/branches', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  removeBranch: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/branches/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  setMasterBranch: (id: string) =>
    requestJson<BranchConfig[]>(`/api/branches/${encodeURIComponent(id)}/set-master`, {
      method: 'POST',
    }),
  scanBranches: (rootDir: string) =>
    requestJson<ScannedWorkingCopy[]>('/api/branches/scan', {
      method: 'POST',
      body: JSON.stringify({ rootDir }),
    }),

  getAllStatus: (remote = false) =>
    requestJson<BranchStatus[]>(`/api/svn/status-all?remote=${remote ? 'true' : 'false'}`),
  getBranchStatus: (branchId: string, remote = false) =>
    requestJson<BranchStatus>(
      `/api/svn/${encodeURIComponent(branchId)}/status?remote=${remote ? 'true' : 'false'}`
    ),
  updateAll: () =>
    requestJson<{ results: Array<{ branchId: string; branchName: string; ok: boolean; error?: string }> }>(
      '/api/svn/update-all',
      { method: 'POST' }
    ),
  updateBranch: (branchId: string) =>
    requestJson<{ output: string; newRevision: number }>(
      `/api/svn/${encodeURIComponent(branchId)}/update`,
      { method: 'POST' }
    ),
  commitBranch: (branchId: string, files: string[], message: string) =>
    requestJson<{ output: string; newRevision?: number }>(
      `/api/svn/${encodeURIComponent(branchId)}/commit`,
      {
        method: 'POST',
        body: JSON.stringify({ files, message }),
      }
    ),
  getDiff: (branchId: string, file?: string, rev?: number) => {
    const params = new URLSearchParams();
    if (file) params.set('file', file);
    if (rev !== undefined) params.set('rev', String(rev));
    const qs = params.toString();
    return requestJson<{ diff: string }>(
      `/api/svn/${encodeURIComponent(branchId)}/diff${qs ? `?${qs}` : ''}`
    );
  },
  getLog: (branchId: string, limit = 30) =>
    requestJson<LogEntry[]>(`/api/svn/${encodeURIComponent(branchId)}/log?limit=${limit}`),
  revertBranch: (branchId: string, files?: string[]) =>
    requestJson<{ output: string }>(`/api/svn/${encodeURIComponent(branchId)}/revert`, {
      method: 'POST',
      body: JSON.stringify({ files }),
    }),
  cleanupBranch: (branchId: string) =>
    requestJson<{ output: string }>(`/api/svn/${encodeURIComponent(branchId)}/cleanup`, {
      method: 'POST',
    }),

  getEligibleRevisions: (sourceId: string, targetId: string) =>
    requestJson<LogEntry[]>(
      `/api/merge/eligible?sourceId=${encodeURIComponent(sourceId)}&targetId=${encodeURIComponent(targetId)}`
    ),
  preflightMerge: (sourceId: string, targetId: string) =>
    requestJson<PreflightResult>('/api/merge/preflight', {
      method: 'POST',
      body: JSON.stringify({ sourceId, targetId }),
    }),
  testMerge: (sourceId: string, targetId: string, mode: MergeMode, revisions: number[] = []) =>
    requestJson<MergePreviewResult>('/api/merge/test', {
      method: 'POST',
      body: JSON.stringify({ sourceId, targetId, mode, revisions }),
    }),
  getMergeFileDiff: (
    sourceId: string,
    targetId: string,
    filePath: string,
    revisions: number[] = []
  ) =>
    requestJson<{ diff: string }>('/api/merge/preview-diff', {
      method: 'POST',
      body: JSON.stringify({ sourceId, targetId, filePath, revisions }),
    }),
  confirmMerge: (sourceId: string, targetId: string, mode: MergeMode, revisions: number[] = []) =>
    requestJson<MergeExecuteResult>('/api/merge/confirm', {
      method: 'POST',
      body: JSON.stringify({ sourceId, targetId, mode, revisions }),
    }),
  rollbackMerge: (targetId: string) =>
    requestJson<{ output: string }>('/api/merge/rollback', {
      method: 'POST',
      body: JSON.stringify({ targetId }),
    }),

  listAllConflicts: () => requestJson<ConflictListItem[]>('/api/conflicts'),
  getConflictDetail: (branchId: string, file: string) =>
    requestJson<ConflictFileDetail>(
      `/api/conflicts/${encodeURIComponent(branchId)}/detail?file=${encodeURIComponent(file)}`
    ),
  saveAndResolveConflict: (branchId: string, filePath: string, resolvedContent: string) =>
    requestJson<{ output: string }>(`/api/conflicts/${encodeURIComponent(branchId)}/save-resolve`, {
      method: 'POST',
      body: JSON.stringify({ filePath, resolvedContent }),
    }),
  quickResolveConflict: (
    branchId: string,
    filePath: string,
    strategy: ConflictQuickStrategy
  ) =>
    requestJson<{ output: string }>(
      `/api/conflicts/${encodeURIComponent(branchId)}/quick-resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ filePath, strategy }),
      }
    ),

  openInEditor: (branchId: string, filePath: string) =>
    requestJson<{ ok: boolean; simulated?: boolean; message?: string }>('/api/system/open-editor', {
      method: 'POST',
      body: JSON.stringify({ branchId, filePath }),
    }),
  openFolder: (branchId: string) =>
    requestJson<{ ok: boolean; simulated?: boolean; message?: string }>('/api/system/open-folder', {
      method: 'POST',
      body: JSON.stringify({ branchId }),
    }),

  getLogs: () => requestJson<CommandLogEntry[]>('/api/logs'),
  clearLogs: () => requestJson<{ ok: boolean }>('/api/logs', { method: 'DELETE' }),
  getHistory: () => requestJson<OperationHistoryEntry[]>('/api/history'),
};
