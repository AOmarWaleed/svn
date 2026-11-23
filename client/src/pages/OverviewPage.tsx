import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Code2,
  DownloadCloud,
  FileDiff,
  FolderOpen,
  GitMerge,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  AlertTriangle,
} from 'lucide-react';
import type {
  EnvModuleStatus,
  HealthInfo,
  ModuleMapping,
  RepoOverview,
} from '../../../shared/types';
import { api } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ModuleCommitModal } from '../components/ModuleCommitModal';
import { ModuleDetailModal } from '../components/ModuleDetailModal';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

interface OverviewPageProps {
  overview: RepoOverview | null;
  health: HealthInfo | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onStartTransfer: (sourceEnvId: string, targetEnvId: string, moduleIds?: string[]) => void;
  onGoConflicts: () => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  overview,
  health,
  loading,
  onRefresh,
  onStartTransfer,
  onGoConflicts,
}) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [commitTarget, setCommitTarget] = useState<{
    mod: ModuleMapping;
    envLabel: string;
    status: EnvModuleStatus;
  } | null>(null);
  const [detailTarget, setDetailTarget] = useState<{
    mod: ModuleMapping;
    envId: string;
    envLabel: string;
  } | null>(null);
  const [revertTarget, setRevertTarget] = useState<{
    mod: ModuleMapping;
    envId: string;
  } | null>(null);

  if (!overview) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
      </div>
    );
  }

  const runCellAction = async (key: string, fn: () => Promise<void>) => {
    setBusyCell(key);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyCell(null);
    }
  };

  const quickFlows = [
    { label: t('flowDevToTest'), src: 'dev', tgt: 'test', cls: 'bg-indigo-600 hover:bg-indigo-500 text-white' },
    { label: t('flowTestToDev'), src: 'test', tgt: 'dev', cls: 'bg-sky-600 hover:bg-sky-500 text-white' },
    { label: t('flowDevToMaster'), src: 'dev', tgt: 'master', cls: 'bg-emerald-600 hover:bg-emerald-500 text-white' },
    { label: t('flowTestToMaster'), src: 'test', tgt: 'master', cls: 'bg-amber-600 hover:bg-amber-500 text-white' },
    { label: t('flowMasterToDev'), src: 'master', tgt: 'dev', cls: 'border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Info Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
          <div className="text-xs font-semibold text-slate-500">{t('repoInfoRoot')}</div>
          <div dir="ltr" className="mt-1 text-xs font-mono font-bold text-slate-800 dark:text-slate-100 truncate">
            {overview.activeRepoRoot}
          </div>
          <div dir="ltr" className="mt-0.5 text-[11px] font-mono text-slate-500 truncate">
            {overview.repoUrl}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
          <div className="text-xs font-semibold text-slate-500">{t('repoInfoRev')}</div>
          <div dir="ltr" className="mt-1 text-xl font-extrabold font-mono text-indigo-500">
            r{overview.revision}
          </div>
          {overview.lastChangedAuthor && (
            <div dir="ltr" className="text-[11px] font-mono text-slate-500">
              {overview.lastChangedAuthor}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onGoConflicts}
          className={`text-start rounded-2xl border p-4 transition-colors ${
            overview.totalConflicts > 0
              ? 'border-rose-500/50 bg-rose-500/10 hover:bg-rose-500/15'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90'
          }`}
        >
          <div className="text-xs font-semibold text-slate-500">{t('repoInfoConflicts')}</div>
          <div
            className={`mt-1 text-2xl font-extrabold ${
              overview.totalConflicts > 0 ? 'text-rose-500' : 'text-emerald-500'
            }`}
          >
            {overview.totalConflicts}
          </div>
        </button>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
          <div className="text-xs font-semibold text-slate-500">{t('repoInfoVscode')}</div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`text-base font-extrabold ${
                health?.vscodeAvailable ? 'text-emerald-500' : 'text-amber-500'
              }`}
            >
              {health?.vscodeAvailable ? t('vscodeReady') : t('vscodeMissing')}
            </span>
          </div>
          {health?.vscodePath && (
            <div dir="ltr" className="text-[11px] font-mono text-slate-500 truncate">
              {health.vscodePath}
            </div>
          )}
        </div>
      </div>

      {/* Quick Transfer Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase px-1">
            {t('quickTransfersTitle')}:
          </span>
          {quickFlows.map((f) => (
            <button
              key={f.label}
              type="button"
              dir="ltr"
              onClick={() => onStartTransfer(f.src, f.tgt)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono transition-colors ${f.cls}`}
            >
              <GitMerge className="w-3.5 h-3.5" />
              {f.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </button>
      </div>

      {/* Modules × Environments Matrix */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse min-w-[920px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500 w-56">
                  {t('matrixColModule')}
                </th>
                {overview.envs.map((env) => (
                  <th
                    key={env.id}
                    className="px-4 py-3 text-xs font-bold uppercase text-slate-500"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: env.color }}
                      />
                      <span dir="ltr" className="font-mono text-slate-800 dark:text-slate-100">
                        {env.label}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {overview.rows.map((row) => (
                <tr key={row.module.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3.5 align-top">
                    <div className="font-bold text-sm text-slate-900 dark:text-white">
                      {row.module.name}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500">
                        {row.module.category}
                      </span>
                      <button
                        type="button"
                        onClick={() => onStartTransfer('dev', 'master', [row.module.id])}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-500 hover:underline"
                      >
                        {t('btnTransferThis')}
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </td>

                  {overview.envs.map((env) => {
                    const st = row.envs[env.id];
                    const cellKey = `${row.module.id}::${env.id}`;
                    const isBusy = busyCell === cellKey;
                    const dirtyCount =
                      (st?.modifiedCount ?? 0) +
                      (st?.addedCount ?? 0) +
                      (st?.deletedCount ?? 0) +
                      (st?.untrackedCount ?? 0);

                    return (
                      <td key={env.id} className="px-4 py-3.5 align-top">
                        {!st || !st.relativePath ? (
                          <span className="text-xs text-slate-400 italic">{t('notMapped')}</span>
                        ) : !st.exists ? (
                          <div className="space-y-1">
                            <div dir="ltr" className="text-[11px] font-mono text-slate-500">
                              {st.relativePath}
                            </div>
                            <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400">
                              {t('missingFolder')}
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div dir="ltr" className="text-[11px] font-mono text-slate-500 truncate max-w-[240px]">
                              {st.relativePath}
                            </div>

                            {/* Badges */}
                            <div className="flex flex-wrap gap-1.5">
                              {st.isClean && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-500">
                                  <CheckCircle2 className="w-3 h-3" />
                                  {t('cleanStatus')}
                                </span>
                              )}
                              {st.conflictCount > 0 && (
                                <button
                                  type="button"
                                  onClick={onGoConflicts}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40"
                                >
                                  <AlertTriangle className="w-3 h-3" />
                                  {t('conflictShort')}: {st.conflictCount}
                                </button>
                              )}
                              {st.modifiedCount > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-400">
                                  {t('modifiedShort')}: {st.modifiedCount}
                                </span>
                              )}
                              {(st.addedCount > 0 || st.untrackedCount > 0) && (
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400">
                                  {t('untrackedShort')}: {st.addedCount + st.untrackedCount}
                                </span>
                              )}
                              {st.deletedCount > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400">
                                  {t('deletedShort')}: {st.deletedCount}
                                </span>
                              )}
                            </div>

                            {/* Cell Quick Actions */}
                            <div className="flex flex-wrap items-center gap-1">
                              <button
                                type="button"
                                disabled={isBusy}
                                title={t('btnUpdate')}
                                onClick={() =>
                                  runCellAction(cellKey, async () => {
                                    const res = await api.updateModuleEnv(row.module.id, env.id);
                                    toast(res.output || 'Updated', 'success');
                                    await onRefresh();
                                  })
                                }
                                className="p-1.5 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-sky-500/10"
                              >
                                <DownloadCloud className="w-3.5 h-3.5" />
                              </button>

                              {dirtyCount > 0 && st.conflictCount === 0 && (
                                <button
                                  type="button"
                                  title={t('btnCommit')}
                                  onClick={() =>
                                    setCommitTarget({
                                      mod: row.module,
                                      envLabel: env.label,
                                      status: st,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold"
                                >
                                  <Send className="w-3 h-3" />
                                  {t('btnCommit')}
                                </button>
                              )}

                              <button
                                type="button"
                                title={t('btnDiffLog')}
                                onClick={() =>
                                  setDetailTarget({
                                    mod: row.module,
                                    envId: env.id,
                                    envLabel: env.label,
                                  })
                                }
                                className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10"
                              >
                                <FileDiff className="w-3.5 h-3.5" />
                              </button>

                              {!st.isClean && (
                                <button
                                  type="button"
                                  title={t('btnRevert')}
                                  onClick={() =>
                                    setRevertTarget({ mod: row.module, envId: env.id })
                                  }
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}

                              <button
                                type="button"
                                title={t('btnVsCode')}
                                onClick={() =>
                                  api
                                    .openVsCodeFolder(row.module.id, env.id)
                                    .then(() => toast('Opened in VS Code', 'success'))
                                    .catch((e) => toast(e.message, 'error'))
                                }
                                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-500/10"
                              >
                                <Code2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                title={t('btnFolder')}
                                onClick={() =>
                                  api
                                    .openFolder(row.module.id, env.id)
                                    .catch((e) => toast(e.message, 'error'))
                                }
                                className="p-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-amber-500/10"
                              >
                                <FolderOpen className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ModuleCommitModal
        open={Boolean(commitTarget)}
        module={commitTarget?.mod ?? null}
        envLabel={commitTarget?.envLabel ?? ''}
        status={commitTarget?.status ?? null}
        onClose={() => setCommitTarget(null)}
        onCommitted={onRefresh}
      />

      <ModuleDetailModal
        open={Boolean(detailTarget)}
        module={detailTarget?.mod ?? null}
        envId={detailTarget?.envId ?? 'master'}
        envLabel={detailTarget?.envLabel ?? ''}
        onClose={() => setDetailTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(revertTarget)}
        title={t('confirmRevertTitle')}
        message={t('confirmRevertMsg')}
        danger
        onCancel={() => setRevertTarget(null)}
        onConfirm={async () => {
          if (!revertTarget) return;
          try {
            const res = await api.revertModuleEnv(revertTarget.mod.id, revertTarget.envId);
            toast(res.output, 'info');
            setRevertTarget(null);
            await onRefresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : String(err), 'error');
          }
        }}
      />
    </div>
  );
};
