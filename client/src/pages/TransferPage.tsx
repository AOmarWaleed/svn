import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Code2,
  FlaskConical,
  GitMerge,
  Loader2,
  RotateCcw,
  Send,
  Shield,
  Wrench,
  AlertTriangle,
} from 'lucide-react';
import type {
  FolderFileAction,
  FolderFileDiffItem,
  ModuleApplyPlan,
  ModuleEligibleInfo,
  RepoOverview,
  TransferApplyResponse,
  TransferEngine,
  TransferPreviewResponse,
} from '../../../shared/types';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DiffViewer } from '../components/DiffViewer';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

interface TransferPageProps {
  overview: RepoOverview | null;
  initialSourceEnvId?: string;
  initialTargetEnvId?: string;
  initialModuleIds?: string[];
  onRefreshOverview: () => Promise<void>;
  onGoConflicts: () => void;
}

export const TransferPage: React.FC<TransferPageProps> = ({
  overview,
  initialSourceEnvId,
  initialTargetEnvId,
  initialModuleIds,
  onRefreshOverview,
  onGoConflicts,
}) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sourceEnvId, setSourceEnvId] = useState(initialSourceEnvId || 'dev');
  const [targetEnvId, setTargetEnvId] = useState(initialTargetEnvId || 'test');
  const [engine, setEngine] = useState<TransferEngine>('folder-sync');
  const [selectedModules, setSelectedModules] = useState<Record<string, boolean>>(() => {
    if (initialModuleIds?.length) {
      return Object.fromEntries(initialModuleIds.map((id) => [id, true]));
    }
    return { 'billing-backend': true };
  });

  // SVN-merge options
  const [ignoreAncestry, setIgnoreAncestry] = useState(false);
  const [eligibleInfo, setEligibleInfo] = useState<ModuleEligibleInfo[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [revisionsByModule, setRevisionsByModule] = useState<Record<string, number[]>>({});

  // Preview state
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<TransferPreviewResponse | null>(null);
  const [activePreviewModId, setActivePreviewModId] = useState<string>('');
  const [activePreviewFile, setActivePreviewFile] = useState<FolderFileDiffItem | null>(null);
  const [fileActionOverrides, setFileActionOverrides] = useState<
    Record<string, Record<string, FolderFileAction>>
  >({});

  // Apply state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<TransferApplyResponse | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    if (initialSourceEnvId) setSourceEnvId(initialSourceEnvId);
    if (initialTargetEnvId) setTargetEnvId(initialTargetEnvId);
    if (initialModuleIds && initialModuleIds.length > 0) {
      setSelectedModules(Object.fromEntries(initialModuleIds.map((id) => [id, true])));
    }
  }, [initialSourceEnvId, initialTargetEnvId, initialModuleIds]);

  const envs = overview?.envs ?? [];
  const rows = overview?.rows ?? [];

  const chosenModuleIds = useMemo(
    () => Object.entries(selectedModules).filter(([, v]) => v).map(([k]) => k),
    [selectedModules]
  );

  useEffect(() => {
    if (engine !== 'svn-merge' || chosenModuleIds.length === 0 || sourceEnvId === targetEnvId) {
      setEligibleInfo([]);
      return;
    }
    let cancelled = false;
    setLoadingEligible(true);
    api
      .getEligibleRevisions(sourceEnvId, targetEnvId, chosenModuleIds)
      .then((res) => {
        if (!cancelled) setEligibleInfo(res);
      })
      .catch(() => {
        if (!cancelled) setEligibleInfo([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingEligible(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, sourceEnvId, targetEnvId, chosenModuleIds]);

  const handleRunPreview = async () => {
    if (chosenModuleIds.length === 0 || sourceEnvId === targetEnvId) return;
    setLoadingPreview(true);
    try {
      const res = await api.previewTransfer({
        engine,
        sourceEnvId,
        targetEnvId,
        moduleIds: chosenModuleIds,
        ignoreAncestry,
        revisionsByModule,
      });
      setPreview(res);
      setFileActionOverrides({});
      const firstMod = res.folderModules?.[0] ?? res.svnModules?.[0];
      setActivePreviewModId(firstMod?.moduleId ?? '');
      setActivePreviewFile(res.folderModules?.[0]?.files?.[0] ?? null);
      setStep(2);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleConfirmApply = async () => {
    if (!preview) return;
    setApplying(true);
    try {
      const modulePlans: ModuleApplyPlan[] = chosenModuleIds.map((mId) => ({
        moduleId: mId,
        fileActions: fileActionOverrides[mId] ?? {},
      }));
      const res = await api.applyTransfer({
        engine: preview.engine,
        sourceEnvId: preview.sourceEnvId,
        targetEnvId: preview.targetEnvId,
        moduleIds: chosenModuleIds,
        modulePlans,
        ignoreAncestry,
        revisionsByModule,
      });
      setApplyResult(res);
      setCommitMessage(res.suggestedCommitMessage);
      setConfirmOpen(false);
      setStep(3);
      await onRefreshOverview();
      if (res.conflicts.length > 0) {
        toast(`${res.conflicts.length} file(s) ready in VS Code Conflict Center`, 'info');
      } else {
        toast('Transfer applied cleanly!', 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setApplying(false);
    }
  };

  const handleOpenAllInVsCode = async () => {
    try {
      const res = await api.openAllConflictsInVsCode({ targetEnvId });
      toast(`Opened ${res.count} file(s) in VS Code`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleRollback = async () => {
    if (!applyResult) return;
    setRollingBack(true);
    try {
      await api.rollbackTransfer({
        rollbackId: applyResult.rollbackId,
        targetEnvId,
        moduleIds: chosenModuleIds,
      });
      toast('Transfer rolled back cleanly', 'info');
      await onRefreshOverview();
      setApplyResult(null);
      setPreview(null);
      setStep(1);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setRollingBack(false);
    }
  };

  const handleCommitClean = async () => {
    if (!commitMessage.trim() || !overview) return;
    setCommitting(true);
    try {
      let committedCount = 0;
      for (const mId of chosenModuleIds) {
        const row = overview.rows.find((r) => r.module.id === mId);
        const st = row?.envs[targetEnvId];
        if (!st || st.conflictCount > 0 || st.files.length === 0) continue;
        const files = st.files.map((f) => f.path);
        await api.commitModuleEnv(mId, targetEnvId, files, commitMessage.trim());
        committedCount++;
      }
      toast(`Committed ${committedCount} module(s) successfully`, 'success');
      await onRefreshOverview();
      setStep(1);
      setPreview(null);
      setApplyResult(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setCommitting(false);
    }
  };

  const activeFolderModule = preview?.folderModules?.find(
    (m) => m.moduleId === activePreviewModId
  );
  const activeSvnModule = preview?.svnModules?.find(
    (m) => m.moduleId === activePreviewModId
  );

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            { num: 1 as const, label: t('step1Label') },
            { num: 2 as const, label: t('step2Label') },
            { num: 3 as const, label: t('step3Label') },
          ].map((s) => (
            <div
              key={s.num}
              className={`rounded-xl px-3 py-2.5 text-xs sm:text-sm font-bold text-center ${
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

      {/* STEP 1 */}
      {step === 1 && (
        <div className="space-y-5">
          {/* Direction & Engine */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold">{t('transferTitle')}</h2>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: 'DEV → TEST', s: 'dev', t: 'test' },
                  { label: 'TEST → DEV', s: 'test', t: 'dev' },
                  { label: 'DEV → MASTER', s: 'dev', t: 'master' },
                  { label: 'TEST → MASTER', s: 'test', t: 'master' },
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    dir="ltr"
                    onClick={() => {
                      setSourceEnvId(p.s);
                      setTargetEnvId(p.t);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold ${
                      sourceEnvId === p.s && targetEnvId === p.t
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-11 gap-3 items-end">
              <div className="md:col-span-5">
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                  {t('sourceEnvLabel')}
                </label>
                <select
                  dir="ltr"
                  value={sourceEnvId}
                  onChange={(e) => setSourceEnvId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-mono"
                >
                  {envs.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1 flex justify-center">
                <button
                  type="button"
                  title={t('swapEnvs')}
                  onClick={() => {
                    setSourceEnvId(targetEnvId);
                    setTargetEnvId(sourceEnvId);
                  }}
                  className="p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                </button>
              </div>

              <div className="md:col-span-5">
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                  {t('targetEnvLabel')}
                </label>
                <select
                  dir="ltr"
                  value={targetEnvId}
                  onChange={(e) => setTargetEnvId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-mono"
                >
                  {envs.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Dual Engine Choice */}
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">{t('engineLabel')}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setEngine('folder-sync')}
                  className={`rounded-xl border p-4 text-start transition-all ${
                    engine === 'folder-sync'
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="font-bold text-sm text-indigo-400">{t('engineFolderTitle')}</div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t('engineFolderDesc')}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setEngine('svn-merge')}
                  className={`rounded-xl border p-4 text-start transition-all ${
                    engine === 'svn-merge'
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="font-bold text-sm text-emerald-400">{t('engineSvnTitle')}</div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t('engineSvnDesc')}
                  </p>
                </button>
              </div>
            </div>

            {engine === 'svn-merge' && (
              <div className="space-y-3 pt-1">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ignoreAncestry}
                    onChange={(e) => setIgnoreAncestry(e.target.checked)}
                    className="rounded border-slate-400 text-indigo-600"
                  />
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {t('ignoreAncestryLabel')}
                  </span>
                </label>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                  <div className="text-xs font-bold text-slate-500">
                    {t('eligibleRevsSection')}
                  </div>
                  {loadingEligible ? (
                    <div className="text-xs text-slate-400 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t('loadingEligibleRevs')}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {eligibleInfo.map((info) => (
                        <div key={info.moduleId} className="space-y-1">
                          <div className="text-xs font-bold text-indigo-400">{info.moduleName}</div>
                          {info.ancestryWarning && (
                            <div dir="ltr" className="text-[11px] font-mono text-amber-400">
                              {info.ancestryWarning}
                            </div>
                          )}
                          {info.revisions.map((r) => {
                            const checked = (revisionsByModule[info.moduleId] ?? []).includes(
                              r.revision
                            );
                            return (
                              <label
                                key={r.revision}
                                className="flex items-center gap-2 text-xs cursor-pointer ps-2"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setRevisionsByModule((prev) => {
                                      const cur = prev[info.moduleId] ?? [];
                                      const next = e.target.checked
                                        ? [...cur, r.revision]
                                        : cur.filter((x) => x !== r.revision);
                                      return { ...prev, [info.moduleId]: next };
                                    });
                                  }}
                                />
                                <span dir="ltr" className="font-mono font-bold text-indigo-400">
                                  r{r.revision}
                                </span>
                                <span className="truncate text-slate-600 dark:text-slate-300">
                                  {r.message}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Multi-Module Selector */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold">
                {t('selectModulesLabel')} ({chosenModuleIds.length}/{rows.length})
              </h3>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedModules(Object.fromEntries(rows.map((r) => [r.module.id, true])))
                  }
                  className="text-indigo-400 hover:underline font-semibold"
                >
                  {t('selectAll')}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedModules({})}
                  className="text-slate-500 hover:underline"
                >
                  {t('selectNone')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {rows.map((r) => {
                const srcPath = r.module.paths[sourceEnvId] || '—';
                const tgtPath = r.module.paths[targetEnvId] || '—';
                const isSelected = Boolean(selectedModules[r.module.id]);
                return (
                  <label
                    key={r.module.id}
                    className={`rounded-xl border p-3 cursor-pointer transition-all flex items-start gap-2.5 ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) =>
                        setSelectedModules((p) => ({ ...p, [r.module.id]: e.target.checked }))
                      }
                      className="mt-1 rounded border-slate-400 text-indigo-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {r.module.name}
                      </div>
                      <div dir="ltr" className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                        {srcPath} → {tgtPath}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={
                  loadingPreview || chosenModuleIds.length === 0 || sourceEnvId === targetEnvId
                }
                onClick={handleRunPreview}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                {loadingPreview ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FlaskConical className="w-4 h-4" />
                )}
                {loadingPreview ? t('runningPreview') : t('btnRunPreview')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Dry-Run Preview */}
      {step === 2 && preview && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-indigo-500/40 bg-indigo-500/10 p-4 flex items-start gap-3">
            <FlaskConical className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-indigo-300">{t('previewBannerTitle')}</h3>
              <p className="text-xs text-indigo-200/80 mt-0.5">{t('previewBannerDesc')}</p>
            </div>
          </div>

          {/* Module Tabs */}
          <div className="flex flex-wrap gap-2">
            {(preview.folderModules ?? preview.svnModules ?? []).map((m) => (
              <button
                key={m.moduleId}
                type="button"
                onClick={() => {
                  setActivePreviewModId(m.moduleId);
                  if ('files' in m) {
                    setActivePreviewFile(m.files[0] ?? null);
                  }
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
                  activePreviewModId === m.moduleId
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {m.moduleName}
              </button>
            ))}
          </div>

          {preview.engine === 'folder-sync' && activeFolderModule && (
            <div className="space-y-4">
              {/* Folder Module Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <div className="text-[11px] font-semibold text-emerald-400">{t('statAdded')}</div>
                  <div className="text-xl font-extrabold text-emerald-500">{activeFolderModule.counts.added}</div>
                </div>
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3">
                  <div className="text-[11px] font-semibold text-sky-400">{t('statModified')}</div>
                  <div className="text-xl font-extrabold text-sky-500">{activeFolderModule.counts.modified}</div>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
                  <div className="text-[11px] font-semibold text-slate-400">{t('statTargetOnly')}</div>
                  <div className="text-xl font-extrabold text-slate-300">{activeFolderModule.counts.targetOnly}</div>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="text-[11px] font-semibold text-amber-400">{t('statProtected')}</div>
                  <div className="text-xl font-extrabold text-amber-500">{activeFolderModule.counts.protected}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3">
                  <div className="text-[11px] font-semibold text-slate-500">{t('statIdentical')}</div>
                  <div className="text-xl font-extrabold text-slate-400">{activeFolderModule.identicalCount}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3">
                  <div className="text-[11px] font-semibold text-slate-500">{t('statIgnored')}</div>
                  <div className="text-xl font-extrabold text-slate-400">{activeFolderModule.ignoredCount}</div>
                </div>
              </div>

              {/* Files Table + Live Diff */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-6 space-y-2 max-h-[460px] overflow-y-auto">
                  {activeFolderModule.files.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-500">
                      Folders are identical (no differences).
                    </div>
                  ) : (
                    activeFolderModule.files.map((f) => {
                      const chosenAction =
                        fileActionOverrides[activeFolderModule.moduleId]?.[f.relPath] ??
                        f.defaultAction;
                      const isActive = activePreviewFile?.relPath === f.relPath;

                      return (
                        <div
                          key={f.relPath}
                          onClick={() => setActivePreviewFile(f)}
                          className={`rounded-xl border p-3 cursor-pointer space-y-2 transition-colors ${
                            isActive
                              ? 'border-indigo-500 bg-indigo-500/10'
                              : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span dir="ltr" className="text-xs font-mono font-semibold truncate">
                              {f.relPath}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                                f.category === 'protected'
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : f.category === 'added'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : f.category === 'modified'
                                      ? 'bg-sky-500/20 text-sky-400'
                                      : 'bg-slate-500/20 text-slate-400'
                              }`}
                            >
                              {f.category}
                            </span>
                          </div>

                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center justify-between gap-2"
                          >
                            {f.protectedReason && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                                <Shield className="w-3 h-3" />
                                {f.protectedReason}
                              </span>
                            )}
                            <select
                              value={chosenAction}
                              onChange={(e) => {
                                const val = e.target.value as FolderFileAction;
                                setFileActionOverrides((prev) => ({
                                  ...prev,
                                  [activeFolderModule.moduleId]: {
                                    ...(prev[activeFolderModule.moduleId] ?? {}),
                                    [f.relPath]: val,
                                  },
                                }));
                              }}
                              className="ms-auto rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1 text-xs"
                            >
                              {f.category !== 'target_only' && (
                                <>
                                  <option value="mark-conflict">{t('fileActionMarkConflict')}</option>
                                  <option value="copy">{t('fileActionCopy')}</option>
                                  <option value="diff-in-vscode">{t('fileActionDiffVsCode')}</option>
                                </>
                              )}
                              {f.category === 'target_only' && (
                                <option value="delete">{t('fileActionDelete')}</option>
                              )}
                              <option value="skip">{t('fileActionSkip')}</option>
                            </select>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="lg:col-span-6 min-w-0">
                  <DiffViewer diffText={activePreviewFile?.diffText ?? ''} />
                </div>
              </div>
            </div>
          )}

          {preview.engine === 'svn-merge' && activeSvnModule && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 space-y-4">
              {activeSvnModule.ancestryWarning && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span dir="ltr" className="font-mono">
                    {activeSvnModule.ancestryWarning}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
                  <div className="text-xs text-rose-400">Text Conflicts</div>
                  <div className="text-xl font-extrabold text-rose-500">
                    {activeSvnModule.summary.textConflicts}
                  </div>
                </div>
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
                  <div className="text-xs text-rose-400">Tree Conflicts</div>
                  <div className="text-xl font-extrabold text-rose-500">
                    {activeSvnModule.summary.treeConflicts}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 p-3">
                  <div className="text-xs text-slate-400">Updated</div>
                  <div className="text-xl font-extrabold text-sky-500">
                    {activeSvnModule.summary.updated + activeSvnModule.summary.merged}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 p-3">
                  <div className="text-xs text-slate-400">Added</div>
                  <div className="text-xl font-extrabold text-emerald-500">
                    {activeSvnModule.summary.added}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="text-xs text-amber-400">Protected Hits</div>
                  <div className="text-xl font-extrabold text-amber-500">
                    {activeSvnModule.summary.protectedHits}
                  </div>
                </div>
              </div>

              <pre dir="ltr" className="rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-80">
                {activeSvnModule.rawOutput || 'No SVN merge changes predicted.'}
              </pre>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold"
            >
              {t('btnBack')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/20"
            >
              <GitMerge className="w-4 h-4" />
              {t('btnApplyTransfer')}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Apply Summary */}
      {step === 3 && applyResult && (
        <div className="space-y-5">
          {applyResult.conflicts.length > 0 ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-lg font-bold text-rose-400">
                    {t('applyResultConflicts', { count: applyResult.conflicts.length })}
                  </h3>
                  <div dir="ltr" className="mt-2 space-y-1 text-xs font-mono text-rose-200">
                    {applyResult.conflicts.map((c) => (
                      <div key={c.id}>
                        • [{c.moduleName}] {c.relPath} ({c.kind})
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleOpenAllInVsCode}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold"
                >
                  <Code2 className="w-4 h-4" />
                  {t('btnOpenAllInVsCode')}
                </button>
                <button
                  type="button"
                  onClick={onGoConflicts}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold"
                >
                  <Wrench className="w-4 h-4" />
                  {t('btnGoToConflicts')}
                </button>
                <button
                  type="button"
                  disabled={rollingBack}
                  onClick={handleRollback}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-500/40 text-rose-400 hover:bg-rose-500/15 text-sm font-semibold"
                >
                  <RotateCcw className="w-4 h-4" />
                  {t('btnRollbackTransfer')}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                <h3 className="text-lg font-bold text-emerald-400">{t('applyResultSuccess')}</h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('commitMessageLabel')}
                </label>
                <textarea
                  rows={3}
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={committing || !commitMessage.trim()}
                  onClick={handleCommitClean}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
                >
                  {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {t('btnCommitTargetModules')}
                </button>
                <button
                  type="button"
                  disabled={rollingBack}
                  onClick={handleRollback}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm font-semibold"
                >
                  <RotateCcw className="w-4 h-4" />
                  {t('btnRollbackTransfer')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setPreview(null);
                    setApplyResult(null);
                  }}
                  className="px-4 py-2.5 text-sm font-semibold text-indigo-400 hover:underline"
                >
                  {t('btnNewTransfer')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('confirmApplyTitle')}
        message={t('confirmApplyDesc')}
        confirmLabel={applying ? t('applyingTransfer') : t('btnApplyTransfer')}
        busy={applying}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmApply}
      />
    </div>
  );
};
