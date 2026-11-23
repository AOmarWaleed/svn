import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutGrid,
  GitMerge,
  Code2,
  FolderGit2,
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
import type { HealthInfo, RepoOverview } from '../../shared/types';
import { api } from './api/client';
import { ConsoleDrawer } from './components/ConsoleDrawer';
import { ToastProvider, useToast } from './components/ToastContext';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { ConflictsPage } from './pages/ConflictsPage';
import { MappingPage } from './pages/MappingPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransferPage } from './pages/TransferPage';

type NavTab = 'overview' | 'transfer' | 'conflicts' | 'mapping' | 'settings';

const AppShell: React.FC = () => {
  const { t, toggleLang, theme, toggleTheme } = useI18n();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const [transferSource, setTransferSource] = useState<string>('dev');
  const [transferTarget, setTransferTarget] = useState<string>('test');
  const [transferModules, setTransferModules] = useState<string[] | undefined>(undefined);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [h, ov] = await Promise.all([api.getHealth(), api.getOverview()]);
      setHealth(h);
      setOverview(ov);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleStartTransfer = (
    sourceEnvId: string,
    targetEnvId: string,
    moduleIds?: string[]
  ) => {
    setTransferSource(sourceEnvId);
    setTransferTarget(targetEnvId);
    setTransferModules(moduleIds);
    setActiveTab('transfer');
  };

  const handleQuickResetSample = async () => {
    try {
      await api.resetSampleRepo();
      await loadAll();
      toast('Sample RCM repository restored on disk', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const totalConflicts = overview?.totalConflicts ?? 0;

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    danger?: boolean;
  }> = [
    {
      id: 'overview',
      label: t('navOverview'),
      icon: <LayoutGrid className="w-4 h-4" />,
      badge: overview?.rows.length,
    },
    {
      id: 'transfer',
      label: t('navTransfer'),
      icon: <GitMerge className="w-4 h-4" />,
    },
    {
      id: 'conflicts',
      label: t('navConflicts'),
      icon: <Code2 className="w-4 h-4" />,
      badge: totalConflicts > 0 ? totalConflicts : undefined,
      danger: totalConflicts > 0,
    },
    {
      id: 'mapping',
      label: t('navMapping'),
      icon: <FolderGit2 className="w-4 h-4" />,
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
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 z-40 w-64 shrink-0 border-e border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col transition-transform duration-200 ${
          sidebarOpen
            ? 'translate-x-0'
            : '-translate-x-full rtl:translate-x-full lg:translate-x-0 rtl:lg:translate-x-0'
        }`}
      >
        <div className="px-5 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
                <GitMerge className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                {t('appTitle')}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{t('appSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-slate-400"
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
                      item.danger
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

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 text-xs space-y-2">
          {health?.mode === 'sample' ? (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-amber-400">
                <FlaskConical className="w-3.5 h-3.5" />
                {t('modeSample')}
              </div>
              <button
                type="button"
                onClick={handleQuickResetSample}
                className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold"
              >
                <RotateCcw className="w-3 h-3" />
                {t('resetSample')}
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
        <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-4 lg:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-slate-500"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold truncate">{pageTitle}</h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{t('refresh')}</span>
            </button>

            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Languages className="w-3.5 h-3.5 text-indigo-500" />
              {t('switchLang')}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-500" />
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {activeTab === 'overview' && (
            <OverviewPage
              overview={overview}
              health={health}
              loading={loading}
              onRefresh={loadAll}
              onStartTransfer={handleStartTransfer}
              onGoConflicts={() => setActiveTab('conflicts')}
            />
          )}

          {activeTab === 'transfer' && (
            <TransferPage
              overview={overview}
              initialSourceEnvId={transferSource}
              initialTargetEnvId={transferTarget}
              initialModuleIds={transferModules}
              onRefreshOverview={loadAll}
              onGoConflicts={() => setActiveTab('conflicts')}
            />
          )}

          {activeTab === 'conflicts' && (
            <ConflictsPage onConflictsChanged={loadAll} />
          )}

          {activeTab === 'mapping' && (
            <MappingPage overview={overview} onChanged={loadAll} />
          )}

          {activeTab === 'settings' && (
            <SettingsPage health={health} onSaved={loadAll} />
          )}
        </main>

        <ConsoleDrawer />
      </div>
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
