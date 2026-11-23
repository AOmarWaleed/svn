import React, { useEffect, useRef, useState } from 'react';
import {
  Terminal,
  ChevronUp,
  ChevronDown,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import type { CommandLogEntry } from '../../../shared/types';
import { api } from '../api/client';
import { useI18n } from '../i18n/I18nContext';

export const ConsoleDrawer: React.FC = () => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<CommandLogEntry[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource('/api/logs/stream');

    es.addEventListener('snapshot', (ev) => {
      try {
        setLogs(JSON.parse((ev as MessageEvent).data) as CommandLogEntry[]);
      } catch {
        // ignore
      }
    });

    es.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse((ev as MessageEvent).data) as CommandLogEntry;
        setLogs((prev) => {
          const idx = prev.findIndex((item) => item.id === entry.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = entry;
            return copy;
          }
          return [...prev.slice(-149), entry];
        });
      } catch {
        // ignore
      }
    });

    es.addEventListener('clear', () => setLogs([]));
    return () => es.close();
  }, []);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, open]);

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await api.clearLogs().catch(() => undefined);
    setLogs([]);
  };

  const latest = logs[logs.length - 1];

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen((o) => !o);
        }}
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Terminal className="w-4 h-4 text-indigo-500 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
            {t('consoleTitle')}
          </span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {logs.length}
          </span>
          {latest && (
            <span
              dir="ltr"
              className="hidden md:inline-block truncate max-w-md text-xs font-mono text-slate-500 dark:text-slate-400"
            >
              {latest.command}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {logs.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-rose-500 hover:bg-rose-500/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('consoleClear')}
            </button>
          )}
          {open ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronUp className="w-4 h-4 text-slate-500" />
          )}
        </div>
      </div>

      {open && (
        <div
          ref={scrollRef}
          dir="ltr"
          className="h-56 overflow-y-auto bg-slate-950 border-t border-slate-800 p-3 font-mono text-xs space-y-2"
        >
          {logs.length === 0 ? (
            <div className="text-slate-500 text-center py-8">{t('consoleEmpty')}</div>
          ) : (
            logs.map((entry) => {
              const isExpanded = expandedIds[entry.id] ?? entry.status === 'error';
              return (
                <div
                  key={entry.id}
                  className="rounded-lg border border-slate-800/80 bg-slate-900/70 px-3 py-2"
                >
                  <div
                    onClick={() =>
                      entry.output &&
                      setExpandedIds((p) => ({ ...p, [entry.id]: !isExpanded }))
                    }
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {entry.status === 'running' ? (
                        <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                      ) : entry.status === 'success' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      )}
                      {entry.moduleName && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[11px] shrink-0">
                          {entry.moduleName}
                        </span>
                      )}
                      <span className="text-slate-200 truncate">{entry.command}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-500">
                      {entry.durationMs !== undefined && <span>{entry.durationMs}ms</span>}
                      <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  {entry.output && isExpanded && (
                    <pre className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-slate-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                      {entry.output}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
