export type AppMode = 'sample' | 'real';

export type TransferEngine = 'folder-sync' | 'svn-merge';

export type AuthMode = 'cached' | 'custom';

export interface EnvConfig {
  id: string;
  label: string;
  basePath: string;
  color: string;
  isMaster: boolean;
}

export interface ModuleMapping {
  id: string;
  name: string;
  category: string;
  paths: Record<string, string>;
}

export interface AppSettings {
  mode: AppMode;
  repoRoot: string;
  svnPath: string;
  editorCommand: string;
  authMode: AuthMode;
  username: string;
  password: string;
  trustServerCert: boolean;
  ignorePatterns: string[];
  protectedPatterns: string[];
}

export interface PublicAppSettings extends Omit<AppSettings, 'password'> {
  hasPassword: boolean;
  activeRepoRoot: string;
  sampleRepoRoot: string;
}

export interface UpdateSettingsPayload extends Partial<AppSettings> {
  clearPassword?: boolean;
}

export type FileStatusCode =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'replaced'
  | 'unversioned'
  | 'missing'
  | 'conflicted'
  | 'obstructed'
  | 'external'
  | 'normal';

export interface ScannedSvnFile {
  path: string;
  status: FileStatusCode;
  propStatus?: string;
  treeConflict?: boolean;
  remoteModified?: boolean;
}

export interface EnvModuleStatus {
  envId: string;
  relativePath: string;
  fullPath: string;
  exists: boolean;
  modifiedCount: number;
  addedCount: number;
  deletedCount: number;
  untrackedCount: number;
  conflictCount: number;
  isClean: boolean;
  files: ScannedSvnFile[];
  error?: string;
}

export interface ModuleOverviewRow {
  module: ModuleMapping;
  envs: Record<string, EnvModuleStatus>;
}

export interface RepoOverview {
  mode: AppMode;
  activeRepoRoot: string;
  repoUrl: string;
  revision: number;
  lastChangedAuthor: string;
  lastChangedDate: string;
  envs: EnvConfig[];
  rows: ModuleOverviewRow[];
  totalConflicts: number;
}

export type FolderDiffCategory = 'added' | 'modified' | 'target_only' | 'protected';

export type FolderFileAction = 'copy' | 'mark-conflict' | 'diff-in-vscode' | 'delete' | 'skip';

export interface FolderFileDiffItem {
  relPath: string;
  category: FolderDiffCategory;
  isBinary: boolean;
  sourcePath?: string;
  targetPath?: string;
  protectedReason?: string;
  defaultAction: FolderFileAction;
  diffText?: string;
}

export interface ModuleFolderPreview {
  moduleId: string;
  moduleName: string;
  sourceRelPath: string;
  targetRelPath: string;
  sourceExists: boolean;
  targetExists: boolean;
  identicalCount: number;
  ignoredCount: number;
  counts: {
    added: number;
    modified: number;
    targetOnly: number;
    protected: number;
  };
  files: FolderFileDiffItem[];
}

export interface SvnMergeImpactItem {
  path: string;
  fileAction: string;
  propAction: string;
  treeConflict: boolean;
  isConflict: boolean;
  isProtected: boolean;
  rawLine: string;
}

export interface ModuleSvnMergePreview {
  moduleId: string;
  moduleName: string;
  sourceRelPath: string;
  targetRelPath: string;
  ancestryWarning?: string;
  revisions: number[];
  impacts: SvnMergeImpactItem[];
  summary: {
    total: number;
    updated: number;
    added: number;
    deleted: number;
    merged: number;
    textConflicts: number;
    treeConflicts: number;
    protectedHits: number;
  };
  rawOutput: string;
}

export interface TransferPreviewResponse {
  engine: TransferEngine;
  sourceEnvId: string;
  targetEnvId: string;
  dryRun: true;
  folderModules?: ModuleFolderPreview[];
  svnModules?: ModuleSvnMergePreview[];
  suggestedCommitMessage: string;
}

export interface ModuleApplyPlan {
  moduleId: string;
  fileActions: Record<string, FolderFileAction>;
}

export type ConflictKind = 'svn-text' | 'svn-tree' | 'sync-markers' | 'sync-diff';

export interface ActiveConflictItem {
  id: string;
  moduleId: string;
  moduleName: string;
  targetEnvId: string;
  sourceEnvId?: string;
  relPath: string;
  targetFullPath: string;
  sourceFullPath?: string;
  kind: ConflictKind;
  markerCount: number;
  readyToResolve: boolean;
  description?: string;
  previewDiff?: string;
}

export interface AppliedModuleSummary {
  moduleId: string;
  moduleName: string;
  copied: number;
  markedConflict: number;
  diffQueued: number;
  deleted: number;
  skipped: number;
  svnConflicts: number;
}

export interface TransferApplyResponse {
  ok: boolean;
  engine: TransferEngine;
  rollbackId?: string;
  appliedModules: AppliedModuleSummary[];
  conflicts: ActiveConflictItem[];
  suggestedCommitMessage: string;
}

export interface LogChangedPath {
  action: string;
  path: string;
  copyFromPath?: string;
  copyFromRev?: number;
}

export interface LogEntry {
  revision: number;
  author: string;
  date: string;
  message: string;
  changedPaths: LogChangedPath[];
}

export interface ModuleEligibleInfo {
  moduleId: string;
  moduleName: string;
  revisions: LogEntry[];
  ancestryWarning?: string;
}

export interface CommandLogEntry {
  id: string;
  timestamp: string;
  moduleId?: string;
  moduleName?: string;
  command: string;
  status: 'running' | 'success' | 'error';
  output: string;
  durationMs?: number;
}

export interface OperationHistoryEntry {
  id: string;
  timestamp: string;
  action: string;
  details: string;
  status: 'success' | 'error';
}

export interface HealthInfo {
  ok: boolean;
  mode: AppMode;
  activeRepoRoot: string;
  sampleRepoRoot: string;
  svnAvailable: boolean;
  svnVersion: string | null;
  svnPath: string;
  detectedSvnPaths: string[];
  vscodeAvailable: boolean;
  vscodePath: string | null;
  editorCommand: string;
  platform: string;
}

export interface DiscoveredFolder {
  envId: string;
  name: string;
  relativePath: string;
  fullPath: string;
  alreadyMapped: boolean;
}
