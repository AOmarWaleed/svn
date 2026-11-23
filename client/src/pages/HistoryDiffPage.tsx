import React, { useEffect, useState } from 'react';
import { FileDiff, History, Activity, Loader2 } from 'lucide-react';
import type { BranchStatus, LogEntry, OperationHistoryEntry } from '../../../shared/types';
import { api } from '../api/client';
import { DiffViewer } from '../components/DiffViewer';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

interface HistoryDiffPageProps {
  statuses: BranchStatus[];
  initialBranchId?: string;
}

export const HistoryDiffPage: React.FC<HistoryDiffPageProps> = ({
  statuses,
  initialBranchId,
}) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const [branchId, setBranchId] = useState<string>(
    initialBranchId || statuses[0]?.branchId || ''
  );
  const [tab, setTab] = useState<'wc' | 'log' | 'ops'>('wc');

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [wcDiff, setWcDiff] = useState('');
  const [loadingWcDiff, setLoadingWcDiff] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedRev, setSelectedRev] = useState<number | null>(null);
  const [revDiff, setRevDiff] = useState('');
  const [loadingRevDiff, setLoadingRevDiff] = useState(false);

  const [opHistory, setOpHistory] = useState<OperationHistoryEntry[]>([]);

  useEffect(() => {
    if (initialBranchId) setBranchId(initialBranchId);
    else if (!branchId && statuses[0]) setBranchId(statuses[0].branchId);
  }, [initialBranchId, branchId, statuses]);

  const activeBranch = statuses.find((b) => b.branchId === branchId);
  const changedFiles = (activeBranch?.files ?? []).filter((f) => f.status !== 'normal');

  useEffect(() => {
    if (changedFiles.length > 0) {
      setSelectedFile((prev) =>
        prev && changedFiles.some((f) => f.path === prev) ? prev : changedFiles[0].path
      );
    } else {
      setSelectedFile(null);
      setWcDiff('');
    }
  }, [branchId, activeBranch]);

  useEffect(() => {
    if (tab !== 'wc' || !branchId || !selectedFile) return;
    let cancelled = false;
    setLoadingWcDiff(true);
    api
      .getDiff(branchId, selectedFile)
      .then((res) => {
        if (!cancelled) setWcDiff(res.diff);
      })
      .catch((err) => toast(err.message, 'error'))
      .finally(() => {
        if (!cancelled) setLoadingWcDiff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, branchId, selectedFile, toast]);

  useEffect(() => {
    if (tab !== 'log' || !branchId) return;
    let cancelled = false;
    setLoadingLogs(true);
    api
      .getLog(branchId, 30)
      .then((entries) => {
        if (!cancelled) {
          setLogs(entries);
          if (entries[0]) setSelectedRev(entries[0].revision);
        }
      })
      .catch((err) => toast(err.message, 'error'))
      .finally(() => {
        if (!cancelled) setLoadingLogs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, branchId, toast]);

  useEffect(() => {
    if (tab !== 'log' || !branchId || selectedRev === null) return;
    let cancelled = false;
    setLoadingRevDiff(true);
    api
      .getDiff(branchId, undefined, selectedRev)
      .then((res) => {
        if (!cancelled) setRevDiff(res.diff);
      })
      .catch(() => {
        if (!cancelled) setRevDiff('');
      })
      .finally(() => {
        if (!cancelled) setLoadingRevDiff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, branchId, selectedRev]);

  useEffect(() => {
    if (tab !== 'ops') return;
    api.getHistory().then(setOpHistory).catch(() => undefined);
  }, [tab]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('wc')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'wc'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <FileDiff className="w-4 h-4" />
            {t('tabWcChanges')}
          </button>
          <button
            type="button"
            onClick={() => setTab('log')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'log'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <History className="w-4 h-4" />
            {t('tabCommitLog')}
          </button>
          <button
            type="button"
            onClick={() => setTab('ops')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'ops'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Activity className="w-4 h-4" />
            {t('tabOpHistory')}
          </button>
        </div>

        {tab !== 'ops' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">{t('selectBranchLabel')}:</span>
            <select
              dir="ltr"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-sm font-mono"
            >
              {statuses.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {tab === 'wc' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden">
            {changedFiles.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">{t('noDiffOutput')}</div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[560px] overflow-y-auto">
                {changedFiles.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setSelectedFile(f.path)}
                    className={`w-full text-start px-4 py-3 flex items-center justify-between gap-2 ${
                      selectedFile === f.path
                        ? 'bg-indigo-50 dark:bg-indigo-950/60'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span dir="ltr" className="text-xs font-mono truncate text-slate-800 dark:text-slate-200">
                      {f.path}
                    </span>
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400">
                      {f.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-8 min-w-0">
            {loadingWcDiff ? (
              <div className="h-72 flex items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-800">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : (
              <DiffViewer diffText={wcDiff} />
            )}
          </div>
        </div>
      )}

      {tab === 'log' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden">
            {loadingLogs ? (
              <div className="p-10 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">{t('noLogsFound')}</div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[560px] overflow-y-auto">
                {logs.map((entry) => (
                  <button
                    key={entry.revision}
                    type="button"
                    onClick={() => setSelectedRev(entry.revision)}
                    className={`w-full text-start px-4 py-3 space-y-1 transition-colors ${
                      selectedRev === entry.revision
                        ? 'bg-indigo-50 dark:bg-indigo-950/60'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span dir="ltr" className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-mono text-xs font-bold">
                        r{entry.revision}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(entry.date).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {entry.message}
                    </div>
                    <div dir="ltr" className="text-xs font-mono text-slate-500">
                      {entry.author} • {entry.changedPaths.length} file(s)
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-7 min-w-0">
            {loadingRevDiff ? (
              <div className="h-72 flex items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-800">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : (
              <DiffViewer diffText={revDiff} />
            )}
          </div>
        </div>
      )}

      {tab === 'ops' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 divide-y divide-slate-200 dark:divide-slate-800">
          {opHistory.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">{t('noLogsFound')}</div>
          ) : (
            opHistory.map((item) => (
              <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span dir="ltr" className="px-2 py-0.5 rounded text-xs font-mono bg-slate-100 dark:bg-slate-800 text-indigo-400">
                      {item.action}
                    </span>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {item.details}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-400 shrink-0">
                  {new Date(item.timestamp).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
