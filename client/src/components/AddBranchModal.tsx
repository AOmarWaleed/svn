import React, { useEffect, useState } from 'react';
import { FolderSearch, Plus, X, Crown, Check } from 'lucide-react';
import type { ScannedWorkingCopy } from '../../../shared/types';
import { api } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useToast } from './ToastContext';

interface AddBranchModalProps {
  open: boolean;
  defaultScanRoot: string;
  onClose: () => void;
  onAdded: () => void;
}

export const AddBranchModal: React.FC<AddBranchModalProps> = ({
  open,
  defaultScanRoot,
  onClose,
  onAdded,
}) => {
  const { t } = useI18n();
  const { toast } = useToast();
  const [tab, setTab] = useState<'scan' | 'manual'>('scan');

  // Scan state
  const [scanRoot, setScanRoot] = useState(defaultScanRoot || 'D:\\CompanySVN');
  const [scanning, setScanning] = useState(false);
  const [scannedList, setScannedList] = useState<ScannedWorkingCopy[] | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});
  const [masterScanPath, setMasterScanPath] = useState<string>('');

  // Manual state
  const [manualName, setManualName] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [manualIsMaster, setManualIsMaster] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setScanRoot(defaultScanRoot || 'D:\\CompanySVN');
      setScannedList(null);
      setSelectedPaths({});
      setMasterScanPath('');
      setManualName('');
      setManualPath('');
      setManualIsMaster(false);
    }
  }, [open, defaultScanRoot]);

  if (!open) return null;

  const handleScan = async () => {
    if (!scanRoot.trim()) return;
    setScanning(true);
    try {
      const results = await api.scanBranches(scanRoot.trim());
      setScannedList(results);
      const initialSel: Record<string, boolean> = {};
      let guessMaster = '';
      for (const item of results) {
        if (!item.alreadyAdded) {
          initialSel[item.path] = true;
          if (/master|trunk|main/i.test(item.name) && !guessMaster) {
            guessMaster = item.path;
          }
        }
      }
      setSelectedPaths(initialSel);
      setMasterScanPath(guessMaster);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setScanning(false);
    }
  };

  const handleAddScanned = async () => {
    if (!scannedList) return;
    const toAdd = scannedList.filter((item) => !item.alreadyAdded && selectedPaths[item.path]);
    if (toAdd.length === 0) return;
    setSubmitting(true);
    try {
      for (const item of toAdd) {
        await api.addBranch({
          name: item.name,
          path: item.path,
          isMaster: masterScanPath === item.path,
        });
      }
      toast(`${toAdd.length} branch(es) added`, 'success');
      onAdded();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPath.trim()) return;
    setSubmitting(true);
    try {
      await api.addBranch({
        name: manualName.trim() || manualPath.split(/[/\\]/).filter(Boolean).pop() || 'Branch',
        path: manualPath.trim(),
        isMaster: manualIsMaster,
      });
      toast('Branch added successfully', 'success');
      onAdded();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {t('addBranchModalTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 gap-4">
          <button
            type="button"
            onClick={() => setTab('scan')}
            className={`py-3 text-sm font-semibold border-b-2 transition-colors inline-flex items-center gap-2 ${
              tab === 'scan'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <FolderSearch className="w-4 h-4" />
            {t('tabAutoScan')}
          </button>
          <button
            type="button"
            onClick={() => setTab('manual')}
            className={`py-3 text-sm font-semibold border-b-2 transition-colors inline-flex items-center gap-2 ${
              tab === 'manual'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Plus className="w-4 h-4" />
            {t('tabManualAdd')}
          </button>
        </div>

        {tab === 'scan' ? (
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('scanRootLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  dir="ltr"
                  type="text"
                  value={scanRoot}
                  onChange={(e) => setScanRoot(e.target.value)}
                  placeholder="D:\CompanySVN"
                  className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  disabled={scanning || !scanRoot.trim()}
                  onClick={handleScan}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 shrink-0"
                >
                  {scanning ? t('scanning') : t('btnScan')}
                </button>
              </div>
            </div>

            {scannedList !== null && (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t('selectFoldersToAdd')}
                </div>
                {scannedList.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
                    {t('noScannedFound')}
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
                    {scannedList.map((item) => (
                      <div
                        key={item.path}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white dark:bg-slate-950/60"
                      >
                        <label className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={item.alreadyAdded}
                            checked={Boolean(selectedPaths[item.path])}
                            onChange={(e) =>
                              setSelectedPaths((prev) => ({
                                ...prev,
                                [item.path]: e.target.checked,
                              }))
                            }
                            className="rounded border-slate-400 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {item.name}
                            </div>
                            <div dir="ltr" className="text-xs font-mono text-slate-500 truncate">
                              {item.path}
                            </div>
                          </div>
                        </label>

                        {item.alreadyAdded ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-500">
                            <Check className="w-3 h-3" />
                            {t('alreadyAdded')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setMasterScanPath(item.path)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                              masterScanPath === item.path
                                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                                : 'border-slate-300 dark:border-slate-700 text-slate-500 hover:text-amber-400'
                            }`}
                          >
                            <Crown className="w-3 h-3" />
                            {t('markAsMaster')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                {t('btnCancel')}
              </button>
              <button
                type="button"
                disabled={
                  submitting ||
                  !scannedList?.some((i) => !i.alreadyAdded && selectedPaths[i.path])
                }
                onClick={handleAddScanned}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {t('addSelectedBranches')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleAddManual} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('branchNameLabel')}
              </label>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="feature/new-module"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('branchPathLabel')}
              </label>
              <input
                dir="ltr"
                required
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="D:\CompanySVN\erp-feature"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={manualIsMaster}
                onChange={(e) => setManualIsMaster(e.target.checked)}
                className="rounded border-slate-400 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                {t('setAsMasterLabel')}
              </span>
            </label>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                {t('btnCancel')}
              </button>
              <button
                type="submit"
                disabled={submitting || !manualPath.trim()}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {t('addBranch')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
