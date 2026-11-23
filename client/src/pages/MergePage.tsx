import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  GitMerge,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
  Search,
  ArrowRight,
  Wrench,
} from 'lucide-react';
import type {
  BranchStatus,
  LogEntry,
  MergeExecuteResult,
  MergeFileImpact,
  MergeMode,
  MergePreviewResult,
  PreflightResult,
} from '../../../shared/types';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DiffViewer } from '../components/DiffViewer';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

interface MergePageProps {
  statuses: BranchStatus[];
  initialSourceId?: string;
  initialTargetId?: string;
  onRefreshAll: (remote?: boolean) => Promise<void>;
  onOpenConflicts: (branchId: string) => void;
}

export const MergePage: React.FC<MergePageProps> = ({
  statuses,
  initialSourceId,
  initialTargetId,
  onRefreshAll,
  onOpenConflicts,
}) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const masterBranch = useMemo(
    () => statuses.find((b) => b.isMaster) ?? statuses[0],
    [statuses]
  );
  const firstFeatureBranch = useMemo(
    () => statuses.find((b) => !b.isMaster) ?? statuses[1] ?? statuses[0],
    [statuses]
  );

  const [sourceId, setSourceId] = useState<string>(
    initialSourceId || firstFeatureBranch?.branchId || ''
  );
  const [targetId, setTargetId] = useState<string>(
    initialTargetId || masterBranch?.branchId || ''
  );
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [mergeMode, setMergeMode] = useState<MergeMode>('all');
  const [eligibleRevs, setEligibleRevs] = useState<LogEntry[]>([]);
  const [loadingRevs, setLoadingRevs] = useState(false);
  const [selectedRevs, setSelectedRevs] = useState<Record<number, boolean>>({});
  const [revSearch, setRevSearch] = useState('');

  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [loadingPreflight, setLoadingPreflight] = useState(false);

  const [runningTest, setRunningTest] = useState(false);
  const [preview, setPreview] = useState<MergePreviewResult | null>(null);
  const [impactFilter, setImpactFilter] = useState<'all' | 'conflicts' | 'clean'>('all');
  const [activeImpactPath, setActiveImpactPath] = useState<string | null>(null);
  const [impactDiff, setImpactDiff] = useState<string>('');
  const [loadingImpactDiff, setLoadingImpactDiff] = useState(false);

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [executingMerge, setExecutingMerge] = useState(false);
  const [executeResult, setExecuteResult] = useState<MergeExecuteResult | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  // Sync incoming navigation selection
  useEffect(() => {
    if (initialSourceId) setSourceId(initialSourceId);
    if (initialTargetId) setTargetId(initialTargetId);
  }, [initialSourceId, initialTargetId]);

  // Ensure valid defaults if statuses load after mount
  useEffect(() => {
    if (!sourceId && firstFeatureBranch) setSourceId(firstFeatureBranch.branchId);
    if (!targetId && masterBranch) setTargetId(masterBranch.branchId);
  }, [statuses, sourceId, targetId, firstFeatureBranch, masterBranch]);

  const runPreflight = useCallback(async () => {
    if (!sourceId || !targetId || sourceId === targetId) {
      setPreflight(null);
      return;
    }
    setLoadingPreflight(true);
    try {
      const res = await api.preflightMerge(sourceId, targetId);
      setPreflight(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoadingPreflight(false);
    }
  }, [sourceId, targetId, toast]);

  useEffect(() => {
    runPreflight();
  }, [runPreflight]);

  useEffect(() => {
    if (!sourceId || !targetId || sourceId === targetId) {
      setEligibleRevs([]);
      return;
    }
    let cancelled = false;
    setLoadingRevs(true);
    api
      .getEligibleRevisions(sourceId, targetId)
      .then((revs) => {
        if (!cancelled) {
          setEligibleRevs(revs);
          setSelectedRevs({});
        }
      })
      .catch(() => {
        if (!cancelled) setEligibleRevs([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRevs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, targetId]);

  const selectedRevNumbers = useMemo(
    () =>
      Object.entries(selectedRevs)
        .filter(([, checked]) => checked)
        .map(([rev]) => Number(rev)),
    [selectedRevs]
  );

  const handleRunTestMerge = async () => {
    if (!sourceId || !targetId) return;
    setRunningTest(true);
    try {
      const result = await api.testMerge(
        sourceId,
        targetId,
        mergeMode,
        mergeMode === 'revisions' ? selectedRevNumbers : []
      );
      setPreview(result);
      setImpactFilter('all');
      const sortedFirst = [...result.impacts].sort(
        (a, b) => Number(b.isConflict) - Number(a.isConflict)
      )[0];
      setActiveImpactPath(sortedFirst ? sortedFirst.path : null);
      setImpactDiff('');
      setStep(2);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setRunningTest(false);
    }
  };

  useEffect(() => {
    if (step !== 2 || !preview || !activeImpactPath) {
      setImpactDiff('');
      return;
    }
    let cancelled = false;
    setLoadingImpactDiff(true);
    api
      .getMergeFileDiff(
        preview.sourceBranchId,
        preview.targetBranchId,
        activeImpactPath,
        preview.revisions
      )
      .then((res) => {
        if (!cancelled) setImpactDiff(res.diff);
      })
      .catch(() => {
        if (!cancelled) setImpactDiff('');
      })
      .finally(() => {
        if (!cancelled) setLoadingImpactDiff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, preview, activeImpactPath]);

  const handleConfirmRealMerge = async () => {
    if (!preview) return;
    setExecutingMerge(true);
    try {
      const res = await api.confirmMerge(
        preview.sourceBranchId,
        preview.targetBranchId,
        preview.mode,
        preview.revisions
      );
      setExecuteResult(res);
      setCommitMessage(res.suggestedCommitMessage);
      setConfirmDialogOpen(false);
      setStep(3);
      await onRefreshAll(false);
      if (res.hasConflicts) {
        toast(`Merge applied with ${res.conflictedFiles.length} conflict(s)`, 'info');
      } else {
        toast('Merge applied cleanly with zero conflicts!', 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setExecutingMerge(false);
    }
  };

  const handleRollback = async () => {
    setRollingBack(true);
    try {
      const res = await api.rollbackMerge(targetId);
      toast(res.output, 'info');
      await onRefreshAll(false);
      setExecuteResult(null);
      setPreview(null);
      setStep(1);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setRollingBack(false);
    }
  };

  const handleCommitMerged = async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      const targetStatus = await api.getBranchStatus(targetId, false);
      const filesToCommit = targetStatus.files
        .filter((f) => f.status !== 'normal' && f.status !== 'unversioned')
        .map((f) => f.path);

      if (filesToCommit.length === 0) {
        toast('No merged files found to commit.', 'info');
        return;
      }

      const res = await api.commitBranch(targetId, filesToCommit, commitMessage.trim());
      toast(
        res.newRevision ? `Committed merge at r${res.newRevision}` : 'Merge committed!',
        'success'
      );
      await onRefreshAll(false);
      setStep(1);
      setPreview(null);
      setExecuteResult(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setCommitting(false);
    }
  };

  const sortedFilteredImpacts = useMemo(() => {
    if (!preview) return [] as MergeFileImpact[];
    const list = [...preview.impacts].sort(
      (a, b) => Number(b.isConflict) - Number(a.isConflict)
    );
    if (impactFilter === 'conflicts') return list.filter((i) => i.isConflict);
    if (impactFilter === 'clean') return list.filter((i) => !i.isConflict);
    return list;
  }, [preview, impactFilter]);

  const filteredEligibleRevs = useMemo(() => {
    const q = revSearch.trim().toLowerCase();
    if (!q) return eligibleRevs;
    return eligibleRevs.filter(
      (r) =>
        String(r.revision).includes(q) ||
        r.message.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q)
    );
  }, [eligibleRevs, revSearch]);

  const predictedConflictsTotal =
    (preview?.summary.textConflicts ?? 0) + (preview?.summary.treeConflicts ?? 0);

  return (
    <div className="space-y-6">
      {/* Stepper Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            { num: 1 as const, label: t('mergeStep1') },
            { num: 2 as const, label: t('mergeStep2') },
            { num: 3 as const, label: t('mergeStep3') },
          ].map((s) => (
            <div
              key={s.num}
              className={`rounded-xl px-3 py-2.5 text-xs sm:text-sm font-bold text-center transition-colors ${
                step === s.num
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : step > s.num
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              }`}
            >
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1: Select & Pre-flight */}
      {step === 1 && (
        <div className="space-y-5">
          {/* Source / Target Card */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t('mergeTitle')}
              </h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (firstFeatureBranch && masterBranch) {
                      setSourceId(firstFeatureBranch.branchId);
                      setTargetId(masterBranch.branchId);
                    }
                  }}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-indigo-500/15 hover:text-indigo-400 transition-colors"
                >
                  {t('presetToMaster')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (masterBranch && firstFeatureBranch) {
                      setSourceId(masterBranch.branchId);
                      setTargetId(firstFeatureBranch.branchId);
                    }
                  }}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-indigo-500/15 hover:text-indigo-400 transition-colors"
                >
                  {t('presetSyncMaster')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-11 gap-3 items-end">
              <div className="md:col-span-5">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                  {t('sourceBranchLabel')}
                </label>
                <select
                  dir="ltr"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-slate-100"
                >
                  {statuses.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.name} (r{b.revision})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1 flex justify-center">
                <button
                  type="button"
                  title={t('swapBranches')}
                  onClick={() => {
                    setSourceId(targetId);
                    setTargetId(sourceId);
                  }}
                  className="p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                </button>
              </div>

              <div className="md:col-span-5">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                  {t('targetBranchLabel')}
                </label>
                <select
                  dir="ltr"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-slate-100"
                >
                  {statuses.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.name} (r{b.revision})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Merge Mode */}
            <div className="pt-2">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                {t('mergeModeLabel')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMergeMode('all')}
                  className={`rounded-xl border px-4 py-3 text-start text-sm font-semibold transition-all ${
                    mergeMode === 'all'
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{t('mergeModeAll')}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-500/20">
                      {eligibleRevs.length}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMergeMode('revisions')}
                  className={`rounded-xl border px-4 py-3 text-start text-sm font-semibold transition-all ${
                    mergeMode === 'revisions'
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {t('mergeModeRevisions')}
                </button>
              </div>
            </div>
          </div>

          {/* Cherry-pick Revisions Table */}
          {mergeMode === 'revisions' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t('eligibleRevsTitle')} ({selectedRevNumbers.length}/{eligibleRevs.length})
                </h3>
                <div className="relative w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute top-2.5 left-3" />
                  <input
                    type="text"
                    value={revSearch}
                    onChange={(e) => setRevSearch(e.target.value)}
                    placeholder={t('searchRevsPlaceholder')}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-9 pr-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              {loadingRevs ? (
                <div className="py-8 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('loadingEligibleRevs')}
                </div>
              ) : filteredEligibleRevs.length === 0 ? (
                <div className="py-6 text-center text-sm text-slate-500">{t('noEligibleRevs')}</div>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
                  {filteredEligibleRevs.map((entry) => (
                    <label
                      key={entry.revision}
                      className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(selectedRevs[entry.revision])}
                        onChange={(e) =>
                          setSelectedRevs((prev) => ({
                            ...prev,
                            [entry.revision]: e.target.checked,
                          }))
                        }
                        className="mt-1 rounded border-slate-400 text-indigo-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            dir="ltr"
                            className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-mono text-xs font-bold"
                          >
                            r{entry.revision}
                          </span>
                          <span dir="ltr" className="text-xs font-mono text-slate-500">
                            {entry.author}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(entry.date).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-slate-800 dark:text-slate-200">
                          {entry.message}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pre-flight Check Panel */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {t('preflightTitle')}
              </h3>
              {loadingPreflight && <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />}
            </div>

            {preflight && (
              <div className="space-y-3">
                {preflight.blockers.length === 0 && preflight.warnings.length === 0 && (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-sm text-emerald-500 font-medium">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {t('preflightClean')}
                  </div>
                )}

                {preflight.blockers.length > 0 && (
                  <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-4 space-y-1.5 text-sm text-rose-400">
                    <div className="font-bold flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4" />
                      {t('preflightHasBlockers')}
                    </div>
                    <ul className="list-disc list-inside text-xs space-y-1">
                      {preflight.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {preflight.warnings.length > 0 && (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 space-y-2.5 text-sm text-amber-400">
                    <div className="font-bold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      {t('preflightHasWarnings')}
                    </div>
                    <ul className="list-disc list-inside text-xs space-y-1">
                      {preflight.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {preflight.targetIncomingCount > 0 && (
                        <button
                          type="button"
                          onClick={async () => {
                            await api.updateBranch(targetId);
                            toast('Target updated', 'success');
                            await onRefreshAll(false);
                            await runPreflight();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                        >
                          {t('btnUpdateTargetNow')}
                        </button>
                      )}
                      {preflight.targetModifiedCount > 0 && (
                        <button
                          type="button"
                          onClick={async () => {
                            await api.revertBranch(targetId);
                            toast('Target local changes reverted', 'info');
                            await onRefreshAll(false);
                            await runPreflight();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                        >
                          {t('btnRevertTargetNow')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                disabled={
                  runningTest ||
                  !sourceId ||
                  !targetId ||
                  sourceId === targetId ||
                  Boolean(preflight?.blockers.length) ||
                  (mergeMode === 'revisions' && selectedRevNumbers.length === 0)
                }
                onClick={handleRunTestMerge}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-50"
              >
                {runningTest ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FlaskConical className="w-4 h-4" />
                )}
                {runningTest ? t('runningTestMerge') : t('btnRunTestMerge')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Test Merge Preview */}
      {step === 2 && preview && (
        <div className="space-y-5">
          {/* Dry Run Guarantee Banner */}
          <div className="rounded-2xl border border-indigo-500/40 bg-indigo-500/10 p-4 flex items-start gap-3">
            <FlaskConical className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-indigo-300">{t('dryRunBannerTitle')}</h3>
              <p className="text-xs text-indigo-200/80 mt-0.5">{t('dryRunBannerDesc')}</p>
            </div>
          </div>

          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5">
              <div className="text-xs font-semibold text-rose-400">{t('predictedTextConflicts')}</div>
              <div className="text-2xl font-extrabold text-rose-500 mt-1">
                {preview.summary.textConflicts}
              </div>
            </div>
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5">
              <div className="text-xs font-semibold text-rose-400">{t('predictedTreeConflicts')}</div>
              <div className="text-2xl font-extrabold text-rose-500 mt-1">
                {preview.summary.treeConflicts}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
              <div className="text-xs font-semibold text-slate-500">{t('impactUpdated')}</div>
              <div className="text-2xl font-extrabold text-sky-500 mt-1">
                {preview.summary.updated + preview.summary.merged}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
              <div className="text-xs font-semibold text-slate-500">{t('impactAdded')}</div>
              <div className="text-2xl font-extrabold text-emerald-500 mt-1">
                {preview.summary.added}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
              <div className="text-xs font-semibold text-slate-500">{t('impactDeleted')}</div>
              <div className="text-2xl font-extrabold text-amber-500 mt-1">
                {preview.summary.deleted}
              </div>
            </div>
          </div>

          {/* Impacted Files + Incoming Diff Split View */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center gap-1.5">
                {(['all', 'conflicts', 'clean'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setImpactFilter(f)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      impactFilter === f
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {f === 'all'
                      ? `${t('filterAll')} (${preview.impacts.length})`
                      : f === 'conflicts'
                        ? `${t('filterConflicts')} (${preview.impacts.filter((i) => i.isConflict).length})`
                        : `${t('filterClean')} (${preview.impacts.filter((i) => !i.isConflict).length})`}
                  </button>
                ))}
              </div>

              {sortedFilteredImpacts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
                  {t('noImpactedFiles')}
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
                  {sortedFilteredImpacts.map((imp) => (
                    <button
                      key={imp.path}
                      type="button"
                      onClick={() => setActiveImpactPath(imp.path)}
                      className={`w-full text-start flex items-center gap-2.5 px-3 py-2.5 transition-colors ${
                        activeImpactPath === imp.path
                          ? 'bg-indigo-50 dark:bg-indigo-950/60'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <span
                        className={`w-7 text-center py-0.5 rounded text-[11px] font-mono font-bold shrink-0 ${
                          imp.isConflict
                            ? 'bg-rose-500/20 text-rose-400'
                            : imp.fileAction === 'A'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : imp.fileAction === 'D'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-sky-500/20 text-sky-400'
                        }`}
                      >
                        {imp.treeConflict ? 'TC' : imp.fileAction}
                      </span>
                      <span dir="ltr" className="text-xs font-mono truncate text-slate-800 dark:text-slate-200">
                        {imp.path}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-7 space-y-2 min-w-0">
              <div className="text-xs font-semibold text-slate-500">
                {activeImpactPath ? (
                  <span dir="ltr" className="font-mono text-slate-700 dark:text-slate-300">
                    {activeImpactPath}
                  </span>
                ) : (
                  t('selectFileForIncomingDiff')
                )}
              </div>
              {loadingImpactDiff ? (
                <div className="h-72 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              ) : (
                <DiffViewer diffText={impactDiff} maxHeightClass="max-h-96" />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200"
            >
              {t('btnBack')}
            </button>

            <button
              type="button"
              disabled={executingMerge || preview.impacts.length === 0}
              onClick={() => setConfirmDialogOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/20 disabled:opacity-50"
            >
              <GitMerge className="w-4 h-4" />
              {t('btnConfirmRealMerge')}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Post-Merge Execution */}
      {step === 3 && executeResult && (
        <div className="space-y-5">
          {executeResult.hasConflicts ? (
            <div className="rounded-2xl border border-rose-500/50 bg-rose-500/10 p-6 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-lg font-bold text-rose-400">
                    {t('postMergeConflictsTitle', {
                      count: executeResult.conflictedFiles.length,
                    })}
                  </h3>
                  <p className="text-sm text-rose-200/80 mt-1">{t('postMergeConflictsDesc')}</p>
                </div>
              </div>

              <div className="rounded-xl bg-slate-950/70 border border-rose-500/30 p-3 space-y-1.5">
                {executeResult.conflictedFiles.map((file) => (
                  <div key={file} dir="ltr" className="text-xs font-mono text-rose-300">
                    • {file}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenConflicts(targetId)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold"
                >
                  <Wrench className="w-4 h-4" />
                  {t('btnOpenConflictResolver')}
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  disabled={rollingBack}
                  onClick={handleRollback}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-500/40 text-rose-400 hover:bg-rose-500/15 text-sm font-semibold"
                >
                  <RotateCcw className="w-4 h-4" />
                  {t('btnRollbackMerge')}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-6 space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-lg font-bold text-emerald-400">
                    {t('postMergeCleanTitle')}
                  </h3>
                  <p className="text-sm text-emerald-200/80 mt-1">{t('postMergeCleanDesc')}</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  {t('commitMessageLabel')}
                </label>
                <textarea
                  rows={3}
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={committing || !commitMessage.trim()}
                  onClick={handleCommitMerged}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
                >
                  {committing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {t('btnCommitMerged')}
                </button>

                <button
                  type="button"
                  disabled={rollingBack}
                  onClick={handleRollback}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm font-semibold"
                >
                  <RotateCcw className="w-4 h-4" />
                  {t('btnRollbackMerge')}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setPreview(null);
                    setExecuteResult(null);
                  }}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-indigo-400 hover:underline"
                >
                  {t('btnStartNewMerge')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDialogOpen}
        title={t('confirmMergeDialogTitle')}
        message={
          predictedConflictsTotal > 0
            ? t('confirmMergeDialogWithConflicts', { count: predictedConflictsTotal })
            : t('confirmMergeDialogClean')
        }
        confirmLabel={executingMerge ? t('executingRealMerge') : t('btnConfirmRealMerge')}
        danger={predictedConflictsTotal > 0}
        busy={executingMerge}
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={handleConfirmRealMerge}
      />
    </div>
  );
};
