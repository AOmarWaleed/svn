import React, { useState } from 'react';
import {
  Crown,
  RefreshCw,
  DownloadCloud,
  GitMerge,
  Send,
  FileDiff,
  RotateCcw,
  Sparkles,
  FolderOpen,
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle2,
  ArrowDownToLine,
  Loader2,
} from 'lucide-react';
import type { BranchStatus } from '../../../shared/types';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

interface DashboardPageProps {
  statuses: BranchStatus[];
  loading: boolean;
  onRefreshAll: (remote?: boolean) => Promise<void>;
  onOpenAddModal: () => void;
  onOpenCommitModal: (branch: BranchStatus) => void;
  onNavigateMerge: (branchId: string, isMaster: boolean) => void;
  onNavigateDiff: (branchId: string) => void;
  onNavigateConflicts: (branchId?: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  statuses,
  loading,
  onRefreshAll,
  onOpenAddModal,
  onOpenCommitModal,
  onNavigateMerge,
  onNavigateDiff,
  onNavigateConflicts,
}) => {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busyBranchId, setBusyBranchId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [revertTarget, setRevertTarget] = useState<BranchStatus | null>(null);
  const [removeTarget, setRemoveTarget] = useState<BranchStatus | null>(null);

  const totalBranches = statuses.length;
  const dirtyBranches = statuses.filter((s) => !s.isClean && !s.error).length;
  const totalConflicts = statuses.reduce(
    (sum, s) => sum + s.counts.conflicted + s.counts.treeConflicts,
    0
  );
  const totalIncoming = statuses.reduce((sum, s) => sum + s.counts.incoming, 0);

  const runBranchAction = async (branchId: string, fn: () => Promise<void>) => {
    setBusyBranchId(branchId);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyBranchId(null);
    }
  };

  const handleUpdateAll = async () => {
    setUpdatingAll(true);
    try {
      const res = await api.updateAll();
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast(`Updated with ${failed.length} error(s): ${failed[0].error}`, 'error');
      } else {
        toast(`Updated ${res.results.length} branch(es) successfully`, 'success');
      }
      await onRefreshAll(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setUpdatingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t('kpiTotalBranches')}
          </div>
          <div className="mt-1.5 text-2xl font-extrabold text-slate-900 dark:text-white">
            {totalBranches}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t('kpiDirtyBranches')}
          </div>
          <div className="mt-1.5 text-2xl font-extrabold text-sky-500">{dirtyBranches}</div>
        </div>

        <button
          type="button"
          onClick={() => onNavigateConflicts()}
          className={`text-start rounded-2xl border p-4 shadow-sm transition-all ${
            totalConflicts > 0
              ? 'border-rose-500/50 bg-rose-500/10 hover:bg-rose-500/15'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t('kpiActiveConflicts')}
          </div>
          <div
            className={`mt-1.5 text-2xl font-extrabold ${
              totalConflicts > 0 ? 'text-rose-500' : 'text-emerald-500'
            }`}
          >
            {totalConflicts}
          </div>
        </button>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t('kpiIncomingUpdates')}
          </div>
          <div className="mt-1.5 text-2xl font-extrabold text-amber-500">{totalIncoming}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => onRefreshAll(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {t('checkRemote')}
          </button>

          <button
            type="button"
            disabled={updatingAll || statuses.length === 0}
            onClick={handleUpdateAll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {updatingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <DownloadCloud className="w-4 h-4" />
            )}
            {t('updateAll')}
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenAddModal}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('addBranch')}
        </button>
      </div>

      {/* Branch Cards */}
      {statuses.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-800 p-12 text-center">
          <FolderOpen className="w-10 h-10 mx-auto text-slate-400 mb-3" />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
            {t('emptyBranchesTitle')}
          </h3>
          <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
            {t('emptyBranchesDesc')}
          </p>
          <button
            type="button"
            onClick={onOpenAddModal}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold"
          >
            <Plus className="w-4 h-4" />
            {t('addBranch')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {statuses.map((branch) => {
            const isBusy = busyBranchId === branch.branchId;
            const conflictCount = branch.counts.conflicted + branch.counts.treeConflicts;
            const canCommit =
              branch.counts.modified +
                branch.counts.added +
                branch.counts.deleted +
                branch.counts.unversioned >
                0 && conflictCount === 0;

            return (
              <div
                key={branch.branchId}
                className={`rounded-2xl border p-5 transition-all shadow-sm bg-white dark:bg-slate-900/90 flex flex-col justify-between gap-4 ${
                  conflictCount > 0
                    ? 'border-rose-500/60 ring-1 ring-rose-500/20'
                    : branch.isMaster
                      ? 'border-emerald-500/50 ring-1 ring-emerald-500/15'
                      : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="space-y-3">
                  {/* Top Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {branch.isMaster && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                            <Crown className="w-3 h-3" />
                            {t('masterBadge')}
                          </span>
                        )}
                        <h3
                          dir="ltr"
                          className="text-base font-bold font-mono text-slate-900 dark:text-white truncate"
                        >
                          {branch.name}
                        </h3>
                        {branch.revision > 0 && (
                          <span
                            dir="ltr"
                            className="px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          >
                            r{branch.revision}
                          </span>
                        )}
                      </div>
                      <div
                        dir="ltr"
                        className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400 truncate"
                      >
                        {branch.path}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!branch.isMaster && (
                        <button
                          type="button"
                          title={t('btnSetMaster')}
                          disabled={isBusy}
                          onClick={() =>
                            runBranchAction(branch.branchId, async () => {
                              await api.setMasterBranch(branch.branchId);
                              toast(`Set ${branch.name} as Master`, 'success');
                              await onRefreshAll(false);
                            })
                          }
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                        >
                          <Crown className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        title={t('btnOpenFolder')}
                        onClick={() =>
                          api
                            .openFolder(branch.branchId)
                            .then((r) => {
                              if (r.simulated && r.message) toast(r.message, 'info');
                            })
                            .catch((e) => toast(e.message, 'error'))
                        }
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title={t('btnRemove')}
                        onClick={() => setRemoveTarget(branch)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Error Banner */}
                  {branch.error && (
                    <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-400 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span dir="ltr" className="font-mono break-all">
                        {branch.error}
                      </span>
                    </div>
                  )}

                  {/* Status Pills */}
                  {!branch.error && (
                    <div className="flex flex-wrap items-center gap-2">
                      {branch.isClean && branch.counts.incoming === 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-500">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t('cleanBadge')}
                        </span>
                      )}
                      {conflictCount > 0 && (
                        <button
                          type="button"
                          onClick={() => onNavigateConflicts(branch.branchId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {t('conflictedBadge')}: {conflictCount}
                        </button>
                      )}
                      {branch.counts.modified > 0 && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/15 text-sky-400">
                          {t('modifiedBadge')}: {branch.counts.modified}
                        </span>
                      )}
                      {branch.counts.added > 0 && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400">
                          {t('addedBadge')}: {branch.counts.added}
                        </span>
                      )}
                      {branch.counts.deleted > 0 && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400">
                          {t('deletedBadge')}: {branch.counts.deleted}
                        </span>
                      )}
                      {branch.counts.unversioned > 0 && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/15 text-slate-400">
                          {t('unversionedBadge')}: {branch.counts.unversioned}
                        </span>
                      )}
                      {branch.counts.incoming > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          <ArrowDownToLine className="w-3.5 h-3.5" />
                          {t('incomingBadge')}: {branch.counts.incoming}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Quick changed files preview */}
                  {branch.files.length > 0 && (
                    <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 p-2.5 space-y-1">
                      {branch.files.slice(0, 4).map((f) => (
                        <div key={f.path} className="flex items-center justify-between gap-2 text-xs">
                          <span dir="ltr" className="font-mono text-slate-700 dark:text-slate-300 truncate">
                            {f.path}
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${
                              f.status === 'conflicted' || f.treeConflict
                                ? 'bg-rose-500/20 text-rose-400'
                                : f.remoteModified
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-sky-500/20 text-sky-400'
                            }`}
                          >
                            {f.treeConflict ? 'TREE' : f.remoteModified ? 'INCOMING' : f.status}
                          </span>
                        </div>
                      ))}
                      {branch.files.length > 4 && (
                        <div className="text-[11px] text-slate-500 pt-0.5">
                          +{branch.files.length - 4} more...
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action Bar */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      runBranchAction(branch.branchId, async () => {
                        const res = await api.updateBranch(branch.branchId);
                        toast(`Updated ${branch.name} to r${res.newRevision}`, 'success');
                        await onRefreshAll(false);
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-400 hover:bg-sky-500/25 transition-colors disabled:opacity-50"
                  >
                    <DownloadCloud className="w-3.5 h-3.5" />
                    {t('btnUpdate')}
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigateMerge(branch.branchId, branch.isMaster)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    {t('btnMerge')}
                  </button>

                  {canCommit && (
                    <button
                      type="button"
                      onClick={() => onOpenCommitModal(branch)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {t('btnCommit')}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onNavigateDiff(branch.branchId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <FileDiff className="w-3.5 h-3.5" />
                    {t('btnDiff')}
                  </button>

                  {!branch.isClean && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setRevertTarget(branch)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-500 hover:bg-rose-500/10 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {t('btnRevert')}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      runBranchAction(branch.branchId, async () => {
                        const res = await api.cleanupBranch(branch.branchId);
                        toast(res.output, 'success');
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {t('btnCleanup')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(revertTarget)}
        title={t('confirmRevertTitle')}
        message={t('confirmRevertMsg')}
        danger
        busy={Boolean(revertTarget && busyBranchId === revertTarget.branchId)}
        onCancel={() => setRevertTarget(null)}
        onConfirm={async () => {
          if (!revertTarget) return;
          const target = revertTarget;
          await runBranchAction(target.branchId, async () => {
            const res = await api.revertBranch(target.branchId);
            toast(res.output, 'success');
            setRevertTarget(null);
            await onRefreshAll(false);
          });
        }}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={t('confirmRemoveBranchTitle')}
        message={t('confirmRemoveBranchMsg')}
        danger
        onCancel={() => setRemoveTarget(null)}
        onConfirm={async () => {
          if (!removeTarget) return;
          const target = removeTarget;
          await runBranchAction(target.branchId, async () => {
            await api.removeBranch(target.branchId);
            toast(`Removed ${target.name}`, 'info');
            setRemoveTarget(null);
            await onRefreshAll(false);
          });
        }}
      />
    </div>
  );
};
