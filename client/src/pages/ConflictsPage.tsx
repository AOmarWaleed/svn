import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Columns2,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  FolderTree,
} from 'lucide-react';
import type {
  ConflictFileDetail,
  ConflictHunk,
  ConflictListItem,
  ConflictSegment,
} from '../../../shared/types';
import { api } from '../api/client';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

type HunkChoice =
  | { type: 'mine' }
  | { type: 'theirs' }
  | { type: 'both-mine-first' }
  | { type: 'both-theirs-first' }
  | { type: 'custom'; text: string };

function buildTextFromSegments(
  segments: ConflictSegment[],
  choices: Record<string, HunkChoice>
): string {
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'normal') {
      out.push(...seg.lines);
      continue;
    }
    const { hunk } = seg;
    const c = choices[hunk.id];
    if (!c) {
      out.push(`<<<<<<< ${hunk.mineLabel}`);
      out.push(...hunk.mineLines);
      if (hunk.baseLines) {
        out.push(`||||||| ${hunk.baseLabel ?? '.merge-left'}`);
        out.push(...hunk.baseLines);
      }
      out.push('=======');
      out.push(...hunk.theirsLines);
      out.push(`>>>>>>> ${hunk.theirsLabel}`);
    } else if (c.type === 'mine') {
      out.push(...hunk.mineLines);
    } else if (c.type === 'theirs') {
      out.push(...hunk.theirsLines);
    } else if (c.type === 'both-mine-first') {
      out.push(...hunk.mineLines, ...hunk.theirsLines);
    } else if (c.type === 'both-theirs-first') {
      out.push(...hunk.theirsLines, ...hunk.mineLines);
    } else {
      out.push(...c.text.split(/\r?\n/));
    }
  }
  return out.join('\n');
}

function countMarkersClient(text: string): number {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('<<<<<<< ') || l === '<<<<<<<').length;
}

interface ConflictsPageProps {
  preferredBranchId?: string;
  onConflictsChanged: () => Promise<void>;
}

export const ConflictsPage: React.FC<ConflictsPageProps> = ({
  preferredBranchId,
  onConflictsChanged,
}) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const [conflicts, setConflicts] = useState<ConflictListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [detail, setDetail] = useState<ConflictFileDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [viewMode, setViewMode] = useState<'visual' | 'raw'>('visual');
  const [hunkChoices, setHunkChoices] = useState<Record<string, HunkChoice>>({});
  const [editingHunkId, setEditingHunkId] = useState<string | null>(null);
  const [editingHunkDraft, setEditingHunkDraft] = useState('');
  const [rawText, setRawText] = useState('');
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const items = await api.listAllConflicts();
      setConflicts(items);
      setSelectedKey((prev) => {
        if (prev && items.some((i) => `${i.branchId}::${i.file.path}` === prev)) {
          return prev;
        }
        const preferred = preferredBranchId
          ? items.find((i) => i.branchId === preferredBranchId)
          : undefined;
        const pick = preferred ?? items[0];
        return pick ? `${pick.branchId}::${pick.file.path}` : null;
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoadingList(false);
    }
  }, [preferredBranchId, toast]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const selectedItem = useMemo(
    () => conflicts.find((c) => `${c.branchId}::${c.file.path}` === selectedKey) ?? null,
    [conflicts, selectedKey]
  );

  const loadDetail = useCallback(
    async (item: ConflictListItem) => {
      setLoadingDetail(true);
      setEditingHunkId(null);
      try {
        const res = await api.getConflictDetail(item.branchId, item.file.path);
        setDetail(res);
        setHunkChoices({});
        setRawText(res.rawContent);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
        setDetail(null);
      } finally {
        setLoadingDetail(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (selectedItem) {
      loadDetail(selectedItem);
    } else {
      setDetail(null);
    }
  }, [selectedItem, loadDetail]);

  const applyChoice = (hunk: ConflictHunk, choice: HunkChoice) => {
    if (!detail) return;
    const nextChoices = { ...hunkChoices, [hunk.id]: choice };
    setHunkChoices(nextChoices);
    setRawText(buildTextFromSegments(detail.segments, nextChoices));
    setEditingHunkId(null);
  };

  const applyAll = (type: 'mine' | 'theirs') => {
    if (!detail) return;
    const next: Record<string, HunkChoice> = {};
    for (const h of detail.hunks) {
      next[h.id] = { type };
    }
    setHunkChoices(next);
    setRawText(buildTextFromSegments(detail.segments, next));
    setEditingHunkId(null);
  };

  const remainingMarkers = useMemo(() => countMarkersClient(rawText), [rawText]);

  const handleSaveAndResolve = async () => {
    if (!selectedItem || !detail || remainingMarkers > 0) return;
    setSaving(true);
    try {
      const res = await api.saveAndResolveConflict(
        selectedItem.branchId,
        selectedItem.file.path,
        rawText
      );
      toast(res.output, 'success');
      await onConflictsChanged();
      await loadList();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickResolve = async (strategy: 'working' | 'theirs-full' | 'mine-full') => {
    if (!selectedItem) return;
    setSaving(true);
    try {
      const res = await api.quickResolveConflict(
        selectedItem.branchId,
        selectedItem.file.path,
        strategy
      );
      toast(res.output, 'success');
      await onConflictsChanged();
      await loadList();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!loadingList && conflicts.length === 0) {
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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left Conflict File List */}
      <div className="lg:col-span-4 xl:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-900 dark:text-white">
            {t('conflictedFilesList')} ({conflicts.length})
          </span>
          <button
            type="button"
            onClick={loadList}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800 overflow-y-auto max-h-[680px]">
          {conflicts.map((item) => {
            const key = `${item.branchId}::${item.file.path}`;
            const active = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedKey(key)}
                className={`w-full text-start px-4 py-3 transition-colors space-y-1.5 ${
                  active
                    ? 'bg-rose-500/10 border-l-4 border-rose-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-400">
                    <GitBranch className="w-3 h-3" />
                    <span dir="ltr" className="font-mono">
                      {item.branchName}
                    </span>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.file.treeConflict
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {item.file.treeConflict ? t('treeConflictLabel') : t('textConflictLabel')}
                  </span>
                </div>
                <div
                  dir="ltr"
                  className="text-xs font-mono text-slate-800 dark:text-slate-200 break-all"
                >
                  {item.file.path}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Interactive Resolver */}
      <div className="lg:col-span-8 xl:col-span-9 space-y-4 min-w-0">
        {loadingDetail || !detail ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        ) : detail.kind === 'tree' ? (
          <div className="rounded-2xl border border-amber-500/40 bg-white dark:bg-slate-900 p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-xl bg-amber-500/15 text-amber-500">
                <FolderTree className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {t('treeConflictTitle')}
                </h3>
                <div dir="ltr" className="mt-1 text-sm font-mono text-indigo-400">
                  {detail.fullPath}
                </div>
                <p
                  dir="ltr"
                  className="mt-3 text-xs font-mono rounded-xl bg-slate-950 text-amber-200 p-3 border border-slate-800"
                >
                  {detail.treeConflictDescription || 'Tree conflict detected on working copy path.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => handleQuickResolve('working')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {t('btnKeepLocalTree')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleQuickResolve('theirs-full')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {t('btnAcceptIncomingTree')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  if (!selectedItem) return;
                  setSaving(true);
                  try {
                    const res = await api.revertBranch(selectedItem.branchId, [
                      selectedItem.file.path,
                    ]);
                    toast(res.output, 'info');
                    await onConflictsChanged();
                    await loadList();
                  } finally {
                    setSaving(false);
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-sm font-semibold"
              >
                <RotateCcw className="w-4 h-4" />
                {t('btnRevertTreeFile')}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div dir="ltr" className="text-sm font-bold font-mono text-slate-900 dark:text-white break-all">
                    {detail.filePath}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    {remainingMarkers > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t('markersRemainingWarning', { count: remainingMarkers })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t('allHunksResolvedReady')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      api
                        .openInEditor(detail.branchId, detail.filePath)
                        .then((r) => {
                          if (r.simulated && r.message) toast(r.message, 'info');
                          else toast('Opened in external editor', 'success');
                        })
                        .catch((e) => toast(e.message, 'error'))
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t('btnOpenInEditor')}
                  </button>

                  <button
                    type="button"
                    onClick={() => selectedItem && loadDetail(selectedItem)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('btnReloadFromDisk')}
                  </button>

                  <button
                    type="button"
                    disabled={saving || remainingMarkers > 0}
                    onClick={handleSaveAndResolve}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-45"
                  >
                    {saving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    {t('btnSaveAndResolve')}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setViewMode('visual')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      viewMode === 'visual'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Columns2 className="w-3.5 h-3.5" />
                    {t('viewVisualResolver')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('raw')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      viewMode === 'raw'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    {t('viewRawEditor')}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyAll('mine')}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-sky-500/15 text-sky-400 hover:bg-sky-500/25"
                  >
                    {t('btnAcceptAllMine')}
                  </button>
                  <button
                    type="button"
                    onClick={() => applyAll('theirs')}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-500/15 text-purple-400 hover:bg-purple-500/25"
                  >
                    {t('btnAcceptAllTheirs')}
                  </button>
                </div>
              </div>
            </div>

            {/* Body */}
            {viewMode === 'visual' ? (
              <div dir="ltr" className="p-4 bg-slate-950 space-y-3 max-h-[640px] overflow-y-auto">
                {detail.segments.map((seg, idx) => {
                  if (seg.type === 'normal') {
                    return (
                      <pre
                        key={idx}
                        className="font-mono text-xs text-slate-400 px-3 py-1.5 rounded-lg bg-slate-900/50 overflow-x-auto leading-5"
                      >
                        {seg.lines.join('\n')}
                      </pre>
                    );
                  }

                  const { hunk } = seg;
                  const choice = hunkChoices[hunk.id];
                  const isEditing = editingHunkId === hunk.id;

                  return (
                    <div
                      key={hunk.id}
                      className={`rounded-xl border overflow-hidden ${
                        choice
                          ? 'border-emerald-500/50 bg-emerald-950/15'
                          : 'border-rose-500/50 bg-rose-950/15'
                      }`}
                    >
                      {/* Hunk Header & Action Buttons */}
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              choice
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {choice ? t('hunkResolvedLabel') : t('hunkUnresolvedLabel')}
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            {hunk.id} (L{hunk.startLine}-L{hunk.endLine})
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => applyChoice(hunk, { type: 'mine' })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              choice?.type === 'mine'
                                ? 'bg-sky-600 text-white'
                                : 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/30'
                            }`}
                          >
                            {t('btnKeepMine')}
                          </button>
                          <button
                            type="button"
                            onClick={() => applyChoice(hunk, { type: 'theirs' })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              choice?.type === 'theirs'
                                ? 'bg-purple-600 text-white'
                                : 'bg-purple-500/15 text-purple-300 hover:bg-purple-500/30'
                            }`}
                          >
                            {t('btnKeepTheirs')}
                          </button>
                          <button
                            type="button"
                            onClick={() => applyChoice(hunk, { type: 'both-mine-first' })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              choice?.type === 'both-mine-first'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {t('btnKeepBothMineFirst')}
                          </button>
                          <button
                            type="button"
                            onClick={() => applyChoice(hunk, { type: 'both-theirs-first' })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              choice?.type === 'both-theirs-first'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {t('btnKeepBothTheirsFirst')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingHunkId(hunk.id);
                              setEditingHunkDraft(
                                choice?.type === 'custom'
                                  ? choice.text
                                  : [...hunk.mineLines, ...hunk.theirsLines].join('\n')
                              );
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/30"
                          >
                            {t('btnEditHunk')}
                          </button>
                        </div>
                      </div>

                      {/* Side-by-Side Mine vs Theirs */}
                      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800">
                        <div className="p-3 bg-sky-950/20">
                          <div className="text-[11px] font-bold text-sky-400 mb-1.5">
                            {t('mineHeader')} — {hunk.mineLabel}
                          </div>
                          <pre className="font-mono text-xs text-sky-100 whitespace-pre-wrap leading-5">
                            {hunk.mineLines.join('\n') || ' '}
                          </pre>
                        </div>
                        <div className="p-3 bg-purple-950/20">
                          <div className="text-[11px] font-bold text-purple-400 mb-1.5">
                            {t('theirsHeader')} — {hunk.theirsLabel}
                          </div>
                          <pre className="font-mono text-xs text-purple-100 whitespace-pre-wrap leading-5">
                            {hunk.theirsLines.join('\n') || ' '}
                          </pre>
                        </div>
                      </div>

                      {/* Custom Hunk Editor */}
                      {isEditing && (
                        <div className="p-3 border-t border-slate-800 bg-slate-900 space-y-2">
                          <textarea
                            rows={5}
                            value={editingHunkDraft}
                            onChange={(e) => setEditingHunkDraft(e.target.value)}
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingHunkId(null)}
                              className="px-3 py-1 rounded-lg text-xs text-slate-400 hover:text-white"
                            >
                              {t('btnCancel')}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                applyChoice(hunk, { type: 'custom', text: editingHunkDraft })
                              }
                              className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
                            >
                              {t('btnApplyCustomHunk')}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Live Result Preview when resolved */}
                      {choice && !isEditing && (
                        <div className="p-3 border-t border-emerald-500/30 bg-emerald-950/25">
                          <div className="text-[11px] font-bold text-emerald-400 mb-1">
                            Result ({choice.type}):
                          </div>
                          <pre className="font-mono text-xs text-emerald-100 whitespace-pre-wrap leading-5">
                            {choice.type === 'mine'
                              ? hunk.mineLines.join('\n')
                              : choice.type === 'theirs'
                                ? hunk.theirsLines.join('\n')
                                : choice.type === 'both-mine-first'
                                  ? [...hunk.mineLines, ...hunk.theirsLines].join('\n')
                                  : choice.type === 'both-theirs-first'
                                    ? [...hunk.theirsLines, ...hunk.mineLines].join('\n')
                                    : choice.text}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div dir="ltr" className="p-4 bg-slate-950">
                <textarea
                  rows={22}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 p-4 font-mono text-xs text-slate-100 leading-5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
