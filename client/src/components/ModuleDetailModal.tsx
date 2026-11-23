import React, { useEffect, useState } from 'react';
import { X, FileDiff, History, Loader2 } from 'lucide-react';
import type { LogEntry, ModuleMapping } from '../../../shared/types';
import { api } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { DiffViewer } from './DiffViewer';

interface ModuleDetailModalProps {
  open: boolean;
  module: ModuleMapping | null;
  envId: string;
  envLabel: string;
  onClose: () => void;
}

export const ModuleDetailModal: React.FC<ModuleDetailModalProps> = ({
  open,
  module,
  envId,
  envLabel,
  onClose,
}) => {
  const { t } = useI18n();
  const [tab, setTab] = useState<'diff' | 'log'>('diff');
  const [diff, setDiff] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !module) return;
    let cancelled = false;
    setLoading(true);

    if (tab === 'diff') {
      api
        .getModuleDiff(module.id, envId)
        .then((res) => {
          if (!cancelled) setDiff(res.diff);
        })
        .catch(() => {
          if (!cancelled) setDiff('');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      api
        .getModuleLog(module.id, envId, 25)
        .then((entries) => {
          if (!cancelled) setLogs(entries);
        })
        .catch(() => {
          if (!cancelled) setLogs([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [open, module, envId, tab]);

  if (!open || !module) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t('moduleDetailTitle')} —{' '}
              <span dir="ltr" className="font-mono text-indigo-400">
                {module.name} ({envLabel})
              </span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2 px-6 pt-3 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTab('diff')}
            className={`inline-flex items-center gap-1.5 pb-2.5 px-2 text-sm font-semibold border-b-2 ${
              tab === 'diff'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-500'
            }`}
          >
            <FileDiff className="w-4 h-4" />
            {t('tabLocalDiff')}
          </button>
          <button
            type="button"
            onClick={() => setTab('log')}
            className={`inline-flex items-center gap-1.5 pb-2.5 px-2 text-sm font-semibold border-b-2 ${
              tab === 'log'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-500'
            }`}
          >
            <History className="w-4 h-4" />
            {t('tabModuleLog')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="h-48 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            </div>
          ) : tab === 'diff' ? (
            <DiffViewer diffText={diff} />
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">No commits found.</div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
              {logs.map((entry) => (
                <div key={entry.revision} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        dir="ltr"
                        className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-mono text-xs font-bold"
                      >
                        r{entry.revision}
                      </span>
                      <span dir="ltr" className="text-xs font-mono text-slate-500">
                        {entry.author}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {new Date(entry.date).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {entry.message}
                  </div>
                  {entry.changedPaths.length > 0 && (
                    <div dir="ltr" className="pt-1 space-y-0.5 text-[11px] font-mono text-slate-400">
                      {entry.changedPaths.slice(0, 6).map((cp, idx) => (
                        <div key={idx}>
                          [{cp.action}] {cp.path}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
