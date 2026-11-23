import React, { useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  FolderSearch,
  Plus,
  Trash2,
  XCircle,
  X,
} from 'lucide-react';
import type { DiscoveredFolder, ModuleMapping, RepoOverview } from '../../../shared/types';
import { api } from '../api/client';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

interface MappingPageProps {
  overview: RepoOverview | null;
  onChanged: () => Promise<void>;
}

export const MappingPage: React.FC<MappingPageProps> = ({ overview, onChanged }) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const [editing, setEditing] = useState<ModuleMapping | null>(null);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('Core');
  const [formPaths, setFormPaths] = useState<Record<string, string>>({
    master: '',
    dev: '',
    test: '',
  });
  const [saving, setSaving] = useState(false);

  const [discovered, setDiscovered] = useState<DiscoveredFolder[] | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const envs = overview?.envs ?? [];
  const rows = overview?.rows ?? [];

  const openCreate = (prefillName = '', prefillPaths?: Record<string, string>) => {
    setEditing(null);
    setCreating(true);
    setFormName(prefillName);
    setFormCategory('Custom');
    setFormPaths(
      prefillPaths ?? {
        master: prefillName,
        dev: prefillName ? `BRANCHES/DEV/${prefillName}` : '',
        test: prefillName ? `BRANCHES/TEST/${prefillName}` : '',
      }
    );
  };

  const openEdit = (m: ModuleMapping) => {
    setCreating(false);
    setEditing(m);
    setFormName(m.name);
    setFormCategory(m.category);
    setFormPaths({ ...m.paths });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.updateModule(editing.id, {
          name: formName,
          category: formCategory,
          paths: formPaths,
        });
        toast('Module mapping updated', 'success');
      } else {
        await api.addModule({
          name: formName,
          category: formCategory,
          paths: formPaths,
        });
        toast('Module mapping added', 'success');
      }
      setEditing(null);
      setCreating(false);
      await onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      const items = await api.discoverFolders();
      setDiscovered(items.filter((i) => !i.alreadyMapped));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('mappingTitle')}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{t('mappingSubtitle')}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={discovering}
            onClick={handleDiscover}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <FolderSearch className="w-4 h-4 text-sky-500" />
            {t('btnDiscoverFolders')}
          </button>

          <button
            type="button"
            onClick={() => openCreate()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
          >
            <Plus className="w-4 h-4" />
            {t('btnAddModule')}
          </button>
        </div>
      </div>

      {/* Auto-Discovered Unmapped Folders */}
      {discovered !== null && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-sky-400">
              {t('discoveredTitle')} ({discovered.length})
            </span>
            <button
              type="button"
              onClick={() => setDiscovered(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {discovered.length === 0 ? (
            <div className="text-xs text-slate-400">All top-level folders are already mapped.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {discovered.map((d) => (
                <button
                  key={`${d.envId}::${d.relativePath}`}
                  type="button"
                  dir="ltr"
                  onClick={() =>
                    openCreate(d.name, {
                      master: d.envId === 'master' ? d.relativePath : d.name,
                      dev: d.envId === 'dev' ? d.relativePath : `BRANCHES/DEV/${d.name.toLowerCase()}`,
                      test: d.envId === 'test' ? d.relativePath : `BRANCHES/TEST/${d.name.toLowerCase()}`,
                    })
                  }
                  className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-900 text-xs font-mono text-slate-200 hover:border-indigo-500"
                >
                  + [{d.envId}] {d.relativePath}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mapping Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse min-w-[850px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500">
                  {t('colModuleName')}
                </th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500">
                  {t('colCategory')}
                </th>
                {envs.map((e) => (
                  <th
                    key={e.id}
                    dir="ltr"
                    className="px-4 py-3 text-xs font-bold font-mono uppercase text-slate-500"
                  >
                    {e.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map((row) => (
                <tr key={row.module.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-bold text-sm">{row.module.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{row.module.category}</td>
                  {envs.map((e) => {
                    const st = row.envs[e.id];
                    const pathStr = row.module.paths[e.id] || '—';
                    return (
                      <td key={e.id} className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {st?.exists ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          )}
                          <span dir="ltr" className="text-xs font-mono text-slate-700 dark:text-slate-300">
                            {pathStr}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        type="button"
                        title={t('btnEdit')}
                        onClick={() => openEdit(row.module)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title={t('btnDelete')}
                        onClick={async () => {
                          await api.deleteModule(row.module.id);
                          toast('Deleted module mapping', 'info');
                          await onChanged();
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {(creating || editing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                {editing ? `${t('btnEdit')}: ${editing.name}` : t('btnAddModule')}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  {t('colModuleName')}
                </label>
                <input
                  required
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  {t('colCategory')}
                </label>
                <input
                  type="text"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {envs.map((env) => (
              <div key={env.id}>
                <label dir="ltr" className="block text-xs font-mono font-semibold text-slate-500 mb-1">
                  {env.label}
                </label>
                <input
                  dir="ltr"
                  type="text"
                  value={formPaths[env.id] ?? ''}
                  onChange={(e) =>
                    setFormPaths((p) => ({ ...p, [env.id]: e.target.value }))
                  }
                  placeholder={env.basePath ? `${env.basePath}/service-folder` : 'service-folder'}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                />
              </div>
            ))}

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm"
              >
                {t('btnCancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50"
              >
                {t('btnSave')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
