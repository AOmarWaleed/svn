import type {
  BranchConfig,
  BranchStatus,
  ConflictFileDetail,
  ConflictQuickStrategy,
  LogEntry,
  MergeExecuteResult,
  MergeMode,
  MergePreviewResult,
  PreflightResult,
  WorkingCopyFile,
} from '../../../shared/types';

export interface SvnProvider {
  getBranchStatus(branch: BranchConfig, checkRemote?: boolean): Promise<BranchStatus>;
  updateBranch(branch: BranchConfig): Promise<{ output: string; newRevision: number }>;
  commitBranch(
    branch: BranchConfig,
    files: string[],
    message: string
  ): Promise<{ output: string; newRevision?: number }>;
  getDiff(branch: BranchConfig, filePath?: string, revision?: number): Promise<string>;
  getLog(branch: BranchConfig, limit?: number): Promise<LogEntry[]>;
  revert(branch: BranchConfig, files?: string[]): Promise<{ output: string }>;
  cleanup(branch: BranchConfig): Promise<{ output: string }>;
  getEligibleRevisions(source: BranchConfig, target: BranchConfig): Promise<LogEntry[]>;
  preflightMerge(source: BranchConfig, target: BranchConfig): Promise<PreflightResult>;
  testMerge(
    source: BranchConfig,
    target: BranchConfig,
    mode: MergeMode,
    revisions?: number[]
  ): Promise<MergePreviewResult>;
  getMergeFileDiff(
    source: BranchConfig,
    target: BranchConfig,
    filePath: string,
    revisions?: number[]
  ): Promise<string>;
  executeMerge(
    source: BranchConfig,
    target: BranchConfig,
    mode: MergeMode,
    revisions?: number[]
  ): Promise<MergeExecuteResult>;
  listConflicts(branch: BranchConfig): Promise<WorkingCopyFile[]>;
  getConflictDetail(branch: BranchConfig, filePath: string): Promise<ConflictFileDetail>;
  saveAndResolveConflict(
    branch: BranchConfig,
    filePath: string,
    resolvedContent: string
  ): Promise<{ output: string }>;
  quickResolveConflict(
    branch: BranchConfig,
    filePath: string,
    strategy: ConflictQuickStrategy
  ): Promise<{ output: string }>;
}
