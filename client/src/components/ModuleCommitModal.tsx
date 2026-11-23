import React, { useEffect, useState } from 'react';
import { Send, X, AlertTriangle, Loader2 } from 'lucide-react';
import type { EnvModuleStatus, ModuleMapping } from '../../../shared/types';
import { api } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { DiffViewer } from './DiffViewer';
import { useToast } from './ToastContext';

interface ModuleCommitModalProps {
  open: boolean;
  module: ModuleMapping | null;
  envLabel: string;
  status: EnvModuleStatus | null;
  initialMessage?: string;
  onClose: () => void;
  onCommitted: () => void;
}

export const ModuleCommitModal: React.FC<ModuleCommitModalProps> = ({
  open,
  module,
  envLabel,
  status,
  initialMessage = '',
  onClose,
  onCommitted,
}) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState(initialMessage);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [diffText, setDiffText] = useState('');
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const files = status?.files ?? [];

  useEffect(() => {
    if (open && status) {
      const sel: Record<string, boolean> = {};
      for (const f of status.files) {
        if (f.status !== 'conflicted' && !f.treeConflict) sel[f.path] = true;
      }
      setSelected(sel);
      setMessage(
        initialMessage ||
          (module ? `Update ${module.name} in ${envLabel}` : '')
      );
      setActiveFile(status.files[0]?.path ?? null);
      setDiffText('');
    }
  }, [open, status, module, envLabel, initialMessage]);

  useEffect(() => {
    if (!open || !module || !status || !activeFile) {
      setDiffText('');
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    api
      .getModuleDiff(module.id, status.envId, activeFile)
      .then((res) => {
        if (!cancelled) setDiffText(res.diff);
      })
      .catch(() => {
        if (!cancelled) setDiffText('');
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, module, status, activeFile]);

  if (!open || !module || !status) return null;

  const chosen = files
    .filter((f) => selected[f.path] && f.status !== 'conflicted' && !f.treeConflict)
    .map((f) => f.path);

  const handleCommit = async () => {
    if (!message.trim() || chosen.length === 0) return;
    setSubmitting(true);
    try {
      const res = await api.commitModuleEnv(module.id, status.envId, chosen, message.trim());
      toast(
        res.newRevision
          ? `Committed ${module.name} (${envLabel}) at r${res.newRevision}`
          : `Committed ${module.name}`,
        'success'
      );
      onCommitted();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t('commitModalTitle')} —{' '}
              <span dir="ltr" className="font-mono text-indigo-400">
                {module.name} ({envLabel})
              </span>
            </h2>
            <div dir="ltr" className="text-xs font-mono text-slate-500 mt-0.5">
              {status.relativePath}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase">
                {t('selectFilesToCommit')} ({chosen.length}/{files.length})
              </span>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    files.forEach((f) => {
                      if (f.status !== 'conflicted' && !f.treeConflict) next[f.path] = true;
                    });
                    setSelected(next);
                  }}
                  className="text-indigo-400 hover:underline"
                >
                  {t('selectAll')}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected({})}
                  className="text-slate-500 hover:underline"
                >
                  {t('selectNone')}
                </button>
              </div>
            </div>

            {files.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
                {t('noChangesToCommit')}
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
                {files.map((f) => {
                  const isConf = f.status === 'conflicted' || f.treeConflict;
                  return (
                    <div
                      key={f.path}
                      onClick={() => setActiveFile(f.path)}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${
                        activeFile === f.path
                          ? 'bg-indigo-50 dark:bg-indigo-950/60'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isConf}
                        checked={Boolean(selected[f.path])}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelected((p) => ({ ...p, [f.path]: e.target.checked }));
                        }}
                        className="rounded border-slate-400 text-indigo-600"
                      />
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isConf
                            ? 'bg-rose-500/20 text-rose-400'
                            : f.status === 'unversioned' || f.status === 'added'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-sky-500/20 text-sky-400'
                        }`}
                      >
                        {f.status}
                      </span>
                      <span dir="ltr" className="text-xs font-mono truncate flex-1">
                        {f.path}
                      </span>
                      {isConf && <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">
                {t('commitMessageLabel')}
              </label>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('commitMessagePlaceholder')}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          <div className="lg:col-span-7 min-w-0 space-y-2">
            <div dir="ltr" className="text-xs font-mono text-slate-400 truncate">
              {activeFile || 'Select a file'}
            </div>
            {loadingDiff ? (
              <div className="h-64 flex items-center justify-center rounded-xl border border-slate-800">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : (
              <DiffViewer diffText={diffText} maxHeightClass="max-h-80" />
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
          >
            {t('btnCancel')}
          </button>
          <button
            type="button"
            disabled={submitting || chosen.length === 0 || !message.trim()}
            onClick={handleCommit}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {submitting ? t('committing') : t('btnCommitSelected')}
          </button>
        </div>
      </div>
    </div>
  );
};
