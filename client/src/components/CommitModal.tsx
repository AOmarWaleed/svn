import React, { useEffect, useState } from 'react';
import { Send, X, AlertTriangle, Loader2 } from 'lucide-react';
import type { BranchStatus } from '../../../shared/types';
import { api } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { DiffViewer } from './DiffViewer';
import { useToast } from './ToastContext';

interface CommitModalProps {
  open: boolean;
  branch: BranchStatus | null;
  initialMessage?: string;
  onClose: () => void;
  onCommitted: () => void;
}

export const CommitModal: React.FC<CommitModalProps> = ({
  open,
  branch,
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

  const committableFiles = (branch?.files ?? []).filter((f) => f.status !== 'normal');

  useEffect(() => {
    if (open && branch) {
      const initSel: Record<string, boolean> = {};
      for (const f of branch.files) {
        if (f.status !== 'normal' && f.status !== 'conflicted' && !f.treeConflict) {
          initSel[f.path] = true;
        }
      }
      setSelected(initSel);
      setMessage(initialMessage);
      const first = branch.files.find((f) => f.status !== 'normal');
      setActiveFile(first ? first.path : null);
      setDiffText('');
    }
  }, [open, branch, initialMessage]);

  useEffect(() => {
    if (!open || !branch || !activeFile) {
      setDiffText('');
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    api
      .getDiff(branch.branchId, activeFile)
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
  }, [open, branch, activeFile]);

  if (!open || !branch) return null;

  const chosenPaths = committableFiles
    .filter((f) => selected[f.path] && f.status !== 'conflicted' && !f.treeConflict)
    .map((f) => f.path);

  const handleCommit = async () => {
    if (!message.trim() || chosenPaths.length === 0) return;
    setSubmitting(true);
    try {
      const res = await api.commitBranch(branch.branchId, chosenPaths, message.trim());
      toast(
        res.newRevision
          ? `Committed revision r${res.newRevision}`
          : 'Changes committed successfully',
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
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {t('commitModalTitle')} — <span dir="ltr" className="font-mono text-indigo-400">{branch.name}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {t('selectFilesToCommit')} ({chosenPaths.length}/{committableFiles.length})
              </span>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    committableFiles.forEach((f) => {
                      if (f.status !== 'conflicted' && !f.treeConflict) next[f.path] = true;
                    });
                    setSelected(next);
                  }}
                  className="text-indigo-500 hover:underline"
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

            {committableFiles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
                {t('noChangesToCommit')}
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
                {committableFiles.map((f) => {
                  const isConflicted = f.status === 'conflicted' || f.treeConflict;
                  return (
                    <div
                      key={f.path}
                      onClick={() => setActiveFile(f.path)}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                        activeFile === f.path
                          ? 'bg-indigo-50 dark:bg-indigo-950/50'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isConflicted}
                        checked={Boolean(selected[f.path])}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelected((prev) => ({ ...prev, [f.path]: e.target.checked }));
                        }}
                        className="rounded border-slate-400 text-indigo-600"
                      />
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isConflicted
                            ? 'bg-rose-500/20 text-rose-400'
                            : f.status === 'added'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : f.status === 'deleted'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-sky-500/20 text-sky-400'
                        }`}
                      >
                        {f.status}
                      </span>
                      <span dir="ltr" className="text-xs font-mono truncate flex-1 text-slate-800 dark:text-slate-200">
                        {f.path}
                      </span>
                      {isConflicted && <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                {t('commitMessageLabel')}
              </label>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('commitMessagePlaceholder')}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="lg:col-span-7 flex flex-col gap-2 min-w-0">
            <div className="text-xs font-semibold text-slate-500">
              {activeFile ? (
                <span dir="ltr" className="font-mono text-slate-700 dark:text-slate-300">
                  {activeFile}
                </span>
              ) : (
                t('clickFileToPreviewDiff')
              )}
            </div>
            {loadingDiff ? (
              <div className="flex items-center justify-center h-64 rounded-xl border border-slate-200 dark:border-slate-800">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : (
              <DiffViewer diffText={diffText} maxHeightClass="max-h-80" />
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            {t('btnCancel')}
          </button>
          <button
            type="button"
            disabled={submitting || chosenPaths.length === 0 || !message.trim()}
            onClick={handleCommit}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {submitting ? t('committing') : t('btnCommitSelected')}
          </button>
        </div>
      </div>
    </div>
  );
};
