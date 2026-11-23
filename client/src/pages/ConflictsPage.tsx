import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Columns2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { ActiveConflictItem } from '../../../shared/types';
import { api } from '../api/client';
import { DiffViewer } from '../components/DiffViewer';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

interface ConflictsPageProps {
  onConflictsChanged: () => Promise<void>;
}

export const ConflictsPage: React.FC<ConflictsPageProps> = ({ onConflictsChanged }) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const [conflicts, setConflicts] = useState<ActiveConflictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedDiff, setExpandedDiff] = useState<Record<string, boolean>>({});

  const loadConflicts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getConflicts();
      setConflicts(list);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadConflicts();
  }, [loadConflicts]);

  // Auto re-check disk markers when returning from VS Code!
  useEffect(() => {
    const onFocus = () => {
      loadConflicts();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadConflicts]);

  const handleOpenAll = async () => {
    try {
      const res = await api.openAllConflictsInVsCode();
      toast(`Opened ${res.count} file(s) in VS Code`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleOpenOne = async (item: ActiveConflictItem, mode: 'file' | 'diff') => {
    try {
      await api.openConflictInVsCode(item.id, mode);
      toast(
        mode === 'diff' ? 'Opened side-by-side diff in VS Code' : 'Opened file in VS Code',
        'success'
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleResolve = async (
    item: ActiveConflictItem,
    strategy: 'working' | 'source' | 'target'
  ) => {
    setBusyId(item.id);
    try {
      const res = await api.resolveConflict(item.id, strategy);
      toast(res.output, 'success');
      await Promise.all([loadConflicts(), onConflictsChanged()]);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (!loading && conflicts.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-12 text-center">
        <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          {t('noConflictsTitle')}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t('noConflictsDesc')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Toolbar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('conflictsTitle')}
          </h2>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400">
            {conflicts.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={loadConflicts}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('btnRecheckDisk')}
          </button>

          <button
            type="button"
            disabled={conflicts.length === 0}
            onClick={handleOpenAll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-sm disabled:opacity-50"
          >
            <Code2 className="w-4 h-4" />
            {t('btnOpenAllInVsCode')}
          </button>
        </div>
      </div>

      {/* Conflict Items */}
      <div className="space-y-4">
        {conflicts.map((item) => {
          const isBusy = busyId === item.id;
          const showDiff = Boolean(expandedDiff[item.id]);

          return (
            <div
              key={item.id}
              className={`rounded-2xl border p-5 bg-white dark:bg-slate-900/90 space-y-4 ${
                item.readyToResolve
                  ? 'border-emerald-500/50'
                  : 'border-rose-500/50'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/15 text-indigo-400">
                      {item.moduleName}
                    </span>
                    <span
                      dir="ltr"
                      className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase"
                    >
                      {item.targetEnvId}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-800 text-slate-400">
                      {item.kind}
                    </span>
                    {item.kind === 'sync-diff' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/15 text-sky-400">
                        {t('diffReviewPending')}
                      </span>
                    ) : item.markerCount > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t('markersRemaining', { count: item.markerCount })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t('markersClearedReady')}
                      </span>
                    )}
                  </div>

                  <div dir="ltr" className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                    {item.relPath}
                  </div>
                  <div dir="ltr" className="text-xs font-mono text-slate-500 break-all">
                    {item.targetFullPath}
                  </div>
                  {item.description && (
                    <div className="text-xs text-slate-400 pt-0.5">{item.description}</div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenOne(item, 'file')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    {t('btnOpenVsCodeFile')}
                  </button>

                  {item.sourceFullPath && (
                    <button
                      type="button"
                      onClick={() => handleOpenOne(item, 'diff')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs font-semibold"
                    >
                      <Columns2 className="w-3.5 h-3.5" />
                      {t('btnOpenVsCodeDiff')}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleResolve(item, 'source')}
                    className="px-3 py-2 rounded-xl bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 text-xs font-semibold disabled:opacity-50"
                  >
                    {t('btnAcceptSource')}
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleResolve(item, 'target')}
                    className="px-3 py-2 rounded-xl bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 text-xs font-semibold disabled:opacity-50"
                  >
                    {t('btnAcceptTarget')}
                  </button>

                  <button
                    type="button"
                    disabled={isBusy || !item.readyToResolve}
                    onClick={() => handleResolve(item, 'working')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-40"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    {t('btnMarkResolved')}
                  </button>
                </div>
              </div>

              {item.previewDiff && (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedDiff((p) => ({ ...p, [item.id]: !showDiff }))
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:underline"
                  >
                    {showDiff ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {showDiff ? 'Hide Diff Preview' : 'Show Diff Preview'}
                  </button>
                  {showDiff && (
                    <div className="mt-2">
                      <DiffViewer diffText={item.previewDiff} maxHeightClass="max-h-72" />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
