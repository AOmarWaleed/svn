import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  GitMerge,
  AlertTriangle,
  History,
  Settings,
  RefreshCw,
  Sun,
  Moon,
  Languages,
  FlaskConical,
  HardDrive,
  Menu,
  X,
  RotateCcw,
} from 'lucide-react';
import type { BranchStatus, HealthInfo, PublicAppSettings } from '../../shared/types';
import { api } from './api/client';
import { AddBranchModal } from './components/AddBranchModal';
import { CommitModal } from './components/CommitModal';
import { ConsoleDrawer } from './components/ConsoleDrawer';
import { ToastProvider, useToast } from './components/ToastContext';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { ConflictsPage } from './pages/ConflictsPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryDiffPage } from './pages/HistoryDiffPage';
import { MergePage } from './pages/MergePage';
import { SettingsPage } from './pages/SettingsPage';

type NavTab = 'dashboard' | 'merge' | 'conflicts' | 'history' | 'settings';

const AppShell: React.FC = () => {
  const { t, toggleLang, theme, toggleTheme } = useI18n();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [settings, setSettings] = useState<PublicAppSettings | null>(null);
  const [statuses, setStatuses] = useState<BranchStatus[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [commitTarget, setCommitTarget] = useState<BranchStatus | null>(null);

  const [mergeSourcePreset, setMergeSourcePreset] = useState<string | undefined>();
  const [mergeTargetPreset, setMergeTargetPreset] = useState<string | undefined>();
  const [diffBranchPreset, setDiffBranchPreset] = useState<string | undefined>();
  const [conflictBranchPreset, setConflictBranchPreset] = useState<string | undefined>();

  const loadMetadata = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([api.getHealth(), api.getSettings()]);
      setHealth(h);
      setSettings(s);
    } catch {
      // handled on status load
    }
  }, []);

  const refreshAll = useCallback(
    async (remote = false) => {
      setLoadingStatus(true);
      try {
        const list = await api.getAllStatus(remote);
        setStatuses(list);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        setLoadingStatus(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    loadMetadata();
    refreshAll(false);
  }, [loadMetadata, refreshAll]);

  const totalConflicts = useMemo(
    () =>
      statuses.reduce(
        (sum, s) => sum + s.counts.conflicted + s.counts.treeConflicts,
        0
      ),
    [statuses]
  );

  const handleNavigateMerge = (branchId: string, isMaster: boolean) => {
    const master = statuses.find((b) => b.isMaster);
    if (isMaster) {
      const feature = statuses.find((b) => !b.isMaster);
      setMergeSourcePreset(feature?.branchId);
      setMergeTargetPreset(branchId);
    } else {
      setMergeSourcePreset(branchId);
      setMergeTargetPreset(master?.branchId);
    }
    setActiveTab('merge');
  };

  const handleNavigateDiff = (branchId: string) => {
    setDiffBranchPreset(branchId);
    setActiveTab('history');
  };

  const handleNavigateConflicts = (branchId?: string) => {
    setConflictBranchPreset(branchId);
    setActiveTab('conflicts');
  };

  const handleResetDemoQuick = async () => {
    try {
      await api.resetDemo();
      await Promise.all([loadMetadata(), refreshAll(false)]);
      toast('Demo sandbox reset to initial state', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    badgeDanger?: boolean;
  }> = [
    {
      id: 'dashboard',
      label: t('navDashboard'),
      icon: <LayoutDashboard className="w-4 h-4" />,
      badge: statuses.length,
    },
    {
      id: 'merge',
      label: t('navMerge'),
      icon: <GitMerge className="w-4 h-4" />,
    },
    {
      id: 'conflicts',
      label: t('navConflicts'),
      icon: <AlertTriangle className="w-4 h-4" />,
      badge: totalConflicts > 0 ? totalConflicts : undefined,
      badgeDanger: totalConflicts > 0,
    },
    {
      id: 'history',
      label: t('navHistory'),
      icon: <History className="w-4 h-4" />,
    },
    {
      id: 'settings',
      label: t('navSettings'),
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  const pageTitle = navItems.find((n) => n.id === activeTab)?.label ?? t('appTitle');

  return (
    <div className="h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 z-40 w-64 shrink-0 border-e border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full lg:translate-x-0 rtl:lg:translate-x-0'
        }`}
      >
        <div className="px-5 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
                <GitMerge className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-sm tracking-tight text-slate-900 dark:text-white">
                {t('appTitle')}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {t('appSubtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  active
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  {item.label}
                </span>
                {item.badge !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      item.badgeDanger
                        ? 'bg-rose-500 text-white animate-pulse'
                        : active
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 space-y-2">
          {health?.mode === 'demo' ? (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-amber-400">
                <FlaskConical className="w-3.5 h-3.5" />
                {t('modeDemo')}
              </div>
              <button
                type="button"
                onClick={handleResetDemoQuick}
                className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                {t('resetDemo')}
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3">
              <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                <HardDrive className="w-3.5 h-3.5" />
                {t('modeReal')}
              </div>
              {health?.svnVersion && (
                <div dir="ltr" className="mt-1 font-mono text-[11px] text-emerald-300/80">
                  svn v{health.svnVersion}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TopBar */}
        <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-4 lg:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold text-slate-900 dark:text-white truncate">
              {pageTitle}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refreshAll(false)}
              title={t('refreshAll')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{t('refreshAll')}</span>
            </button>

            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Languages className="w-3.5 h-3.5 text-indigo-500" />
              {t('switchLang')}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              title={theme === 'dark' ? t('lightTheme') : t('darkTheme')}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-500" />
              )}
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {activeTab === 'dashboard' && (
            <DashboardPage
              statuses={statuses}
              loading={loadingStatus}
              onRefreshAll={refreshAll}
              onOpenAddModal={() => setAddBranchOpen(true)}
              onOpenCommitModal={(b) => setCommitTarget(b)}
              onNavigateMerge={handleNavigateMerge}
              onNavigateDiff={handleNavigateDiff}
              onNavigateConflicts={handleNavigateConflicts}
            />
          )}

          {activeTab === 'merge' && (
            <MergePage
              statuses={statuses}
              initialSourceId={mergeSourcePreset}
              initialTargetId={mergeTargetPreset}
              onRefreshAll={refreshAll}
              onOpenConflicts={(bId) => handleNavigateConflicts(bId)}
            />
          )}

          {activeTab === 'conflicts' && (
            <ConflictsPage
              preferredBranchId={conflictBranchPreset}
              onConflictsChanged={() => refreshAll(false)}
            />
          )}

          {activeTab === 'history' && (
            <HistoryDiffPage statuses={statuses} initialBranchId={diffBranchPreset} />
          )}

          {activeTab === 'settings' && (
            <SettingsPage
              health={health}
              onSettingsSaved={async () => {
                await loadMetadata();
                await refreshAll(false);
              }}
            />
          )}
        </main>

        {/* Live Command Console Drawer */}
        <ConsoleDrawer />
      </div>

      {/* Modals */}
      <AddBranchModal
        open={addBranchOpen}
        defaultScanRoot={settings?.defaultScanRoot ?? 'D:\\CompanySVN'}
        onClose={() => setAddBranchOpen(false)}
        onAdded={() => refreshAll(false)}
      />

      <CommitModal
        open={Boolean(commitTarget)}
        branch={commitTarget}
        onClose={() => setCommitTarget(null)}
        onCommitted={() => refreshAll(false)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <I18nProvider>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </I18nProvider>
  );
};

export default App;
