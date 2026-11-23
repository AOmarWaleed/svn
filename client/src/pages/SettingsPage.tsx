import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Save,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wrench,
  FlaskConical,
  HardDrive,
} from 'lucide-react';
import type { HealthInfo, PublicAppSettings } from '../../../shared/types';
import { api } from '../api/client';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

interface SettingsPageProps {
  health: HealthInfo | null;
  onSettingsSaved: () => Promise<void>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ health, onSettingsSaved }) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const [settings, setSettings] = useState<PublicAppSettings | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingSvn, setTestingSvn] = useState(false);
  const [svnTestResult, setSvnTestResult] = useState<{
    available: boolean;
    version: string | null;
    error?: string;
    detectedSvnPaths: string[];
  } | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err) => toast(err.message, 'error'));
  }, [toast]);

  if (!settings) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateSettings({
        ...settings,
        ...(passwordInput ? { password: passwordInput } : {}),
      });
      setSettings(updated);
      setPasswordInput('');
      await onSettingsSaved();
      toast('Settings saved successfully', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestSvn = async () => {
    setTestingSvn(true);
    try {
      const res = await api.testSvnPath(settings.svnPath);
      setSvnTestResult(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setTestingSvn(false);
    }
  };

  const handleResetDemo = async () => {
    try {
      await api.resetDemo();
      await onSettingsSaved();
      toast('Demo sandbox restored to initial state', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const detectedPaths = svnTestResult?.detectedSvnPaths ?? health?.detectedSvnPaths ?? [];

  return (
    <form onSubmit={handleSave} className="max-w-4xl space-y-6">
      {/* Execution Mode */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('settingsModeTitle')}
          </h2>
          {settings.mode === 'demo' && (
            <button
              type="button"
              onClick={handleResetDemo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('resetDemo')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setSettings({ ...settings, mode: 'demo' })}
            className={`rounded-xl border p-4 text-start transition-all ${
              settings.mode === 'demo'
                ? 'border-amber-500 bg-amber-500/10'
                : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-sm text-amber-400">
              <FlaskConical className="w-4 h-4" />
              {t('modeDemo')}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('settingsModeDemoDesc')}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSettings({ ...settings, mode: 'real' })}
            className={`rounded-xl border p-4 text-start transition-all ${
              settings.mode === 'real'
                ? 'border-emerald-500 bg-emerald-500/10'
                : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-sm text-emerald-400">
              <HardDrive className="w-4 h-4" />
              {t('modeReal')}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('settingsModeRealDesc')}
            </p>
          </button>
        </div>
      </div>

      {/* SVN CLI Configuration */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-indigo-500" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('settingsSvnTitle')}
          </h2>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">
            {t('svnPathLabel')}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              dir="ltr"
              type="text"
              value={settings.svnPath}
              onChange={(e) => setSettings({ ...settings, svnPath: e.target.value })}
              placeholder="C:\Program Files\TortoiseSVN\bin\svn.exe"
              className="flex-1 min-w-[240px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono"
            />
            <button
              type="button"
              disabled={testingSvn}
              onClick={handleTestSvn}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {t('btnTestSvn')}
            </button>
          </div>
        </div>

        {(svnTestResult || health) && (
          <div className="flex items-center gap-2 text-xs font-semibold">
            {(svnTestResult ? svnTestResult.available : health?.svnAvailable) ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-500">
                <CheckCircle2 className="w-4 h-4" />
                {t('svnConnected', {
                  version: svnTestResult?.version ?? health?.svnVersion ?? 'ok',
                })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-rose-400">
                <XCircle className="w-4 h-4" />
                {t('svnNotFound')}
                {svnTestResult?.error && (
                  <span dir="ltr" className="font-mono">
                    ({svnTestResult.error})
                  </span>
                )}
              </span>
            )}
          </div>
        )}

        {detectedPaths.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-slate-500">{t('detectedPathsLabel')}</div>
            <div className="flex flex-wrap gap-2">
              {detectedPaths.map((p) => (
                <button
                  key={p}
                  type="button"
                  dir="ltr"
                  onClick={() => setSettings({ ...settings, svnPath: p })}
                  className="px-2.5 py-1 rounded-lg text-xs font-mono bg-slate-100 dark:bg-slate-800 hover:bg-indigo-500/20 text-indigo-400"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Authentication & SSL */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-500" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('settingsAuthTitle')}
          </h2>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="authMode"
              checked={settings.authMode === 'cached'}
              onChange={() => setSettings({ ...settings, authMode: 'cached' })}
              className="text-indigo-600"
            />
            <span className="text-sm text-slate-700 dark:text-slate-200">{t('authCached')}</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="authMode"
              checked={settings.authMode === 'custom'}
              onChange={() => setSettings({ ...settings, authMode: 'custom' })}
              className="text-indigo-600"
            />
            <span className="text-sm text-slate-700 dark:text-slate-200">{t('authCustom')}</span>
          </label>
        </div>

        {settings.authMode === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                {t('usernameLabel')}
              </label>
              <input
                dir="ltr"
                type="text"
                value={settings.username}
                onChange={(e) => setSettings({ ...settings, username: e.target.value })}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                {t('passwordLabel')}
              </label>
              <input
                dir="ltr"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={settings.hasPassword ? t('passwordSavedPlaceholder') : ''}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono"
              />
            </div>
          </div>
        )}

        <label className="flex items-center gap-2.5 cursor-pointer pt-2">
          <input
            type="checkbox"
            checked={settings.trustServerCert}
            onChange={(e) => setSettings({ ...settings, trustServerCert: e.target.checked })}
            className="rounded border-slate-400 text-indigo-600"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t('trustCertLabel')}
          </span>
        </label>
      </div>

      {/* Workflow & Editor */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5 text-sky-500" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('settingsWorkflowTitle')}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {t('editorCommandLabel')}
            </label>
            <input
              dir="ltr"
              type="text"
              value={settings.editorCommand}
              onChange={(e) => setSettings({ ...settings, editorCommand: e.target.value })}
              placeholder="code"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {t('defaultScanRootLabel')}
            </label>
            <input
              dir="ltr"
              type="text"
              value={settings.defaultScanRoot}
              onChange={(e) => setSettings({ ...settings, defaultScanRoot: e.target.value })}
              placeholder="D:\CompanySVN"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono"
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoUpdateBeforeMerge}
            onChange={(e) =>
              setSettings({ ...settings, autoUpdateBeforeMerge: e.target.checked })
            }
            className="rounded border-slate-400 text-indigo-600"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t('autoUpdateBeforeMergeLabel')}
          </span>
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shadow-sm disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {t('btnSaveSettings')}
        </button>
      </div>
    </form>
  );
};
