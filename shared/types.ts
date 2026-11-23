export type AppMode = 'real' | 'demo';

export type AuthMode = 'cached' | 'custom';

export interface AppSettings {
  mode: AppMode;
  svnPath: string;
  editorCommand: string;
  authMode: AuthMode;
  username: string;
  password: string;
  trustServerCert: boolean;
  autoUpdateBeforeMerge: boolean;
  defaultScanRoot: string;
}

export interface PublicAppSettings extends Omit<AppSettings, 'password'> {
  hasPassword: boolean;
}

export interface UpdateSettingsPayload extends Partial<AppSettings> {
  clearPassword?: boolean;
}

export interface BranchConfig {
  id: string;
  name: string;
  path: string;
  isMaster: boolean;
  color?: string;
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

export interface WorkingCopyFile {
  path: string;
  status: FileStatusCode;
  propStatus?: string;
  treeConflict?: boolean;
  remoteModified?: boolean;
}

export interface BranchCounts {
  modified: number;
  added: number;
  deleted: number;
  unversioned: number;
  conflicted: number;
  treeConflicts: number;
  incoming: number;
}

export interface BranchStatus {
  branchId: string;
  name: string;
  path: string;
  isMaster: boolean;
  color?: string;
  url: string;
  relativeUrl: string;
  repositoryRoot: string;
  revision: number;
  lastChangedRev: number;
  lastChangedAuthor: string;
  lastChangedDate: string;
  counts: BranchCounts;
  files: WorkingCopyFile[];
  isClean: boolean;
  error?: string;
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

export type MergeMode = 'all' | 'revisions';

export type MergeFileAction = 'U' | 'A' | 'D' | 'G' | 'C' | 'E' | 'R' | ' ';

export interface MergeFileImpact {
  path: string;
  fileAction: MergeFileAction;
  propAction: string;
  treeConflict: boolean;
  isConflict: boolean;
  rawLine: string;
}

export interface MergeImpactSummary {
  total: number;
  updated: number;
  added: number;
  deleted: number;
  merged: number;
  textConflicts: number;
  treeConflicts: number;
}

export interface PreflightResult {
  targetClean: boolean;
  targetModifiedCount: number;
  targetConflictCount: number;
  targetIncomingCount: number;
  sourceValid: boolean;
  targetValid: boolean;
  warnings: string[];
  blockers: string[];
}

export interface MergePreviewResult {
  sourceBranchId: string;
  targetBranchId: string;
  mode: MergeMode;
  revisions: number[];
  dryRun: true;
  impacts: MergeFileImpact[];
  summary: MergeImpactSummary;
  rawOutput: string;
  suggestedCommitMessage: string;
}

export interface MergeExecuteResult {
  success: boolean;
  dryRun: false;
  impacts: MergeFileImpact[];
  summary: MergeImpactSummary;
  hasConflicts: boolean;
  conflictedFiles: string[];
  rawOutput: string;
  suggestedCommitMessage: string;
}

export interface ConflictHunk {
  id: string;
  startLine: number;
  endLine: number;
  mineLabel: string;
  baseLabel?: string;
  theirsLabel: string;
  mineLines: string[];
  baseLines?: string[];
  theirsLines: string[];
}

export type ConflictSegment =
  | { type: 'normal'; lines: string[] }
  | { type: 'conflict'; hunk: ConflictHunk };

export type ConflictQuickStrategy =
  | 'mine-full'
  | 'theirs-full'
  | 'working'
  | 'mine-conflict'
  | 'theirs-conflict';

export interface ConflictFileDetail {
  branchId: string;
  filePath: string;
  fullPath: string;
  kind: 'text' | 'tree';
  treeConflictDescription?: string;
  rawContent: string;
  hunks: ConflictHunk[];
  segments: ConflictSegment[];
  mineFullContent?: string;
  theirsFullContent?: string;
  baseFullContent?: string;
  markerCount: number;
}

export interface ConflictListItem {
  branchId: string;
  branchName: string;
  isMaster: boolean;
  file: WorkingCopyFile;
}

export interface CommandLogEntry {
  id: string;
  timestamp: string;
  branchId?: string;
  branchName?: string;
  command: string;
  status: 'running' | 'success' | 'error';
  output: string;
  durationMs?: number;
}

export interface OperationHistoryEntry {
  id: string;
  timestamp: string;
  action: string;
  branchName?: string;
  targetBranchName?: string;
  details: string;
  status: 'success' | 'error';
}

export interface HealthInfo {
  ok: boolean;
  mode: AppMode;
  svnAvailable: boolean;
  svnVersion: string | null;
  svnPath: string;
  detectedSvnPaths: string[];
  editorCommand: string;
  platform: string;
}

export interface ScannedWorkingCopy {
  name: string;
  path: string;
  alreadyAdded: boolean;
}
