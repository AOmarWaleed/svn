import React, { useMemo, useState } from 'react';
import { Columns2, AlignLeft } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';

interface DiffViewerProps {
  diffText: string;
  emptyText?: string;
  maxHeightClass?: string;
}

interface ParsedDiffLine {
  type: 'header' | 'hunk' | 'add' | 'del' | 'ctx';
  text: string;
  oldNum?: number;
  newNum?: number;
}

function parseUnifiedDiff(diffText: string): ParsedDiffLine[] {
  const rawLines = diffText.split(/\r?\n/);
  const result: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of rawLines) {
    if (
      line.startsWith('Index: ') ||
      line.startsWith('===') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      result.push({ type: 'header', text: line });
    } else if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      result.push({ type: 'hunk', text: line });
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', text: line, newNum: newLine++ });
    } else if (line.startsWith('-')) {
      result.push({ type: 'del', text: line, oldNum: oldLine++ });
    } else {
      result.push({
        type: 'ctx',
        text: line,
        oldNum: oldLine > 0 ? oldLine++ : undefined,
        newNum: newLine > 0 ? newLine++ : undefined,
      });
    }
  }
  return result;
}

interface SplitRow {
  left?: ParsedDiffLine;
  right?: ParsedDiffLine;
  fullHeader?: ParsedDiffLine;
}

function toSplitRows(lines: ParsedDiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i];
    if (cur.type === 'header' || cur.type === 'hunk') {
      rows.push({ fullHeader: cur });
      i++;
      continue;
    }
    if (cur.type === 'ctx') {
      rows.push({ left: cur, right: cur });
      i++;
      continue;
    }
    const dels: ParsedDiffLine[] = [];
    const adds: ParsedDiffLine[] = [];
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++]);
    const maxLen = Math.max(dels.length, adds.length);
    for (let k = 0; k < maxLen; k++) {
      rows.push({ left: dels[k], right: adds[k] });
    }
  }
  return rows;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  diffText,
  emptyText,
  maxHeightClass = 'max-h-[480px]',
}) => {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');

  const parsed = useMemo(() => parseUnifiedDiff(diffText), [diffText]);
  const splitRows = useMemo(
    () => (viewMode === 'split' ? toSplitRows(parsed) : []),
    [parsed, viewMode]
  );

  if (!diffText.trim()) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        {emptyText ?? t('noDiffOutput')}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800">
        <span className="text-xs font-mono text-slate-400">diff</span>
        <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('unified')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
              viewMode === 'unified'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <AlignLeft className="w-3.5 h-3.5" />
            {t('diffViewUnified')}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('split')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
              viewMode === 'split'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            {t('diffViewSplit')}
          </button>
        </div>
      </div>

      <div dir="ltr" className={`overflow-auto font-mono text-xs leading-5 ${maxHeightClass}`}>
        {viewMode === 'unified' ? (
          <table className="w-full border-collapse">
            <tbody>
              {parsed.map((line, idx) => {
                let rowCls = 'hover:bg-slate-900/60';
                let textCls = 'text-slate-300';
                if (line.type === 'header') {
                  rowCls = 'bg-slate-900/90';
                  textCls = 'text-slate-400 font-semibold';
                } else if (line.type === 'hunk') {
                  rowCls = 'bg-sky-950/50';
                  textCls = 'text-sky-300';
                } else if (line.type === 'add') {
                  rowCls = 'bg-emerald-950/45';
                  textCls = 'text-emerald-300';
                } else if (line.type === 'del') {
                  rowCls = 'bg-rose-950/45';
                  textCls = 'text-rose-300';
                }

                return (
                  <tr key={idx} className={rowCls}>
                    <td className="w-10 select-none px-2 text-right text-slate-600 border-r border-slate-800/60">
                      {line.oldNum ?? ''}
                    </td>
                    <td className="w-10 select-none px-2 text-right text-slate-600 border-r border-slate-800/60">
                      {line.newNum ?? ''}
                    </td>
                    <td className={`px-3 whitespace-pre ${textCls}`}>{line.text || ' '}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse table-fixed">
            <tbody>
              {splitRows.map((row, idx) => {
                if (row.fullHeader) {
                  return (
                    <tr
                      key={idx}
                      className={
                        row.fullHeader.type === 'hunk' ? 'bg-sky-950/50' : 'bg-slate-900/90'
                      }
                    >
                      <td
                        colSpan={4}
                        className={`px-3 py-0.5 whitespace-pre ${
                          row.fullHeader.type === 'hunk'
                            ? 'text-sky-300'
                            : 'text-slate-400 font-semibold'
                        }`}
                      >
                        {row.fullHeader.text}
                      </td>
                    </tr>
                  );
                }

                const leftCls =
                  row.left?.type === 'del' ? 'bg-rose-950/45 text-rose-300' : 'text-slate-300';
                const rightCls =
                  row.right?.type === 'add'
                    ? 'bg-emerald-950/45 text-emerald-300'
                    : 'text-slate-300';

                return (
                  <tr key={idx} className="border-b border-slate-900/40">
                    <td
                      className={`w-10 select-none px-2 text-right text-slate-600 border-r border-slate-800/60 ${leftCls}`}
                    >
                      {row.left?.oldNum ?? ''}
                    </td>
                    <td
                      className={`w-1/2 px-2 whitespace-pre overflow-hidden text-ellipsis border-r border-slate-800 ${leftCls}`}
                    >
                      {row.left?.text ?? ''}
                    </td>
                    <td
                      className={`w-10 select-none px-2 text-right text-slate-600 border-r border-slate-800/60 ${rightCls}`}
                    >
                      {row.right?.newNum ?? ''}
                    </td>
                    <td
                      className={`w-1/2 px-2 whitespace-pre overflow-hidden text-ellipsis ${rightCls}`}
                    >
                      {row.right?.text ?? ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
