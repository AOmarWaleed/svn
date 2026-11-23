import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  FlaskConical,
  HardDrive,
  RefreshCw,
  Save,
  Shield,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react';
import type { HealthInfo, PublicAppSettings } from '../../../shared/types';
import { api } from '../api/client';
import { useToast } from '../components/ToastContext';
import { useI18n } from '../i18n/I18nContext';

interface SettingsPageProps {
  health: HealthInfo | null;
  onSaved: () => Promise<void>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ health, onSaved }) => {
  const { t } = useI18n();
  const { toast } = useToast();

  const [settings, setSettings] = useState<PublicAppSettings | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [ignoreText, setIgnoreText] = useState('');
  const [protectedText, setProtectedText] = useState('');
  const [saving, setSaving] = useState(false);

  const [svnStatus, setSvnStatus] = useState<{
    available: boolean;
    version: string | null;
    error?: string;
    detectedSvnPaths: string[];
  } | null>(null);
  const [vscodeStatus, setVscodeStatus] = useState<{
    available: boolean;
    vscodePath: string | null;
  } | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setIgnoreText(s.ignorePatterns.join('\n'));
        setProtectedText(s.protectedPatterns.join('\n'));
      })
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
        ignorePatterns: ignoreText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
        protectedPatterns: protectedText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      });
      setSettings(updated);
      setPasswordInput('');
      await onSaved();
      toast('Settings saved successfully', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const detectedPaths = svnStatus?.detectedSvnPaths ?? health?.detectedSvnPaths ?? [];

  return (
    <form onSubmit={handleSave} className="max-w-4xl space-y-6">
      {/* Mode */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">{t('settingsModeTitle')}</h2>
          {settings.mode === 'sample' && (
            <button
              type="button"
              onClick={async () => {
                await api.resetSampleRepo();
                await onSaved();
                toast('Sample RCM repository restored on disk', 'success');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('resetSample')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setSettings({ ...settings, mode: 'sample' })}
            className={`rounded-xl border p-4 text-start ${
              settings.mode === 'sample'
                ? 'border-amber-500 bg-amber-500/10'
                : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-sm text-amber-400">
              <FlaskConical className="w-4 h-4" />
              {t('modeSample')}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('settingsModeSampleDesc')}
            </p>
            <div dir="ltr" className="mt-2 text-[11px] font-mono text-amber-300/80 truncate">
              {settings.sampleRepoRoot}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSettings({ ...settings, mode: 'real' })}
            className={`rounded-xl border p-4 text-start ${
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
            <div dir="ltr" className="mt-2 text-[11px] font-mono text-emerald-300/80 truncate">
              {settings.repoRoot}
            </div>
          </button>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">
            {t('repoRootLabel')}
          </label>
          <input
            dir="ltr"
            type="text"
            value={settings.repoRoot}
            onChange={(e) => setSettings({ ...settings, repoRoot: e.target.value })}
            placeholder="C:\Users\appdev3l\Desktop\rcm"
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-mono"
          />
        </div>
      </div>

      {/* SVN & VS Code */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <Terminal className="w-4 h-4 text-indigo-500" />
              {t('svnPathLabel')}
            </label>
            <div className="flex gap-2">
              <input
                dir="ltr"
                type="text"
                value={settings.svnPath}
                onChange={(e) => setSettings({ ...settings, svnPath: e.target.value })}
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  const res = await api.testSvn(settings.svnPath);
                  setSvnStatus(res);
                }}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
              >
                {t('btnTestSvn')}
              </button>
            </div>
            {(svnStatus || health) && (
              <div className="text-xs font-semibold">
                {(svnStatus ? svnStatus.available : health?.svnAvailable) ? (
                  <span className="inline-flex items-center gap-1 text-emerald-500">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    v{svnStatus?.version ?? health?.svnVersion}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-rose-400">
                    <XCircle className="w-3.5 h-3.5" />
                    Not detected on this PC
                  </span>
                )}
              </div>
            )}
            {detectedPaths.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {detectedPaths.map((p) => (
                  <button
                    key={p}
                    type="button"
                    dir="ltr"
                    onClick={() => setSettings({ ...settings, svnPath: p })}
                    className="px-2 py-0.5 rounded bg-slate-800 text-[11px] font-mono text-indigo-400"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <Code2 className="w-4 h-4 text-blue-500" />
              {t('editorCmdLabel')}
            </label>
            <div className="flex gap-2">
              <input
                dir="ltr"
                type="text"
                value={settings.editorCommand}
                onChange={(e) => setSettings({ ...settings, editorCommand: e.target.value })}
                placeholder="code"
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  const res = await api.testVsCode();
                  setVscodeStatus(res);
                }}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
              >
                {t('btnTestVsCode')}
              </button>
            </div>
            {(vscodeStatus || health) && (
              <div className="text-xs font-semibold">
                {(vscodeStatus ? vscodeStatus.available : health?.vscodeAvailable) ? (
                  <span dir="ltr" className="inline-flex items-center gap-1 text-emerald-500 font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {vscodeStatus?.vscodePath ?? health?.vscodePath}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-400">
                    <XCircle className="w-3.5 h-3.5" />
                    VS Code CLI not detected
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Auth & SSL */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-500" />
          <h2 className="text-base font-bold">{t('authTitle')}</h2>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="radio"
              checked={settings.authMode === 'cached'}
              onChange={() => setSettings({ ...settings, authMode: 'cached' })}
            />
            <span className="text-sm">{t('authCached')}</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="radio"
              checked={settings.authMode === 'custom'}
              onChange={() => setSettings({ ...settings, authMode: 'custom' })}
            />
            <span className="text-sm">{t('authCustom')}</span>
          </label>
        </div>

        {settings.authMode === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                {t('usernameLabel')}
              </label>
              <input
                dir="ltr"
                type="text"
                value={settings.username}
                onChange={(e) => setSettings({ ...settings, username: e.target.value })}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono"
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
                placeholder={settings.hasPassword ? '••••••••' : ''}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
        )}

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.trustServerCert}
            onChange={(e) => setSettings({ ...settings, trustServerCert: e.target.checked })}
          />
          <span className="text-sm">{t('trustCertLabel')}</span>
        </label>
      </div>

      {/* Ignore & Protected Rules */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-bold">Protection & Ignore Rules</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">
              {t('ignorePatternsLabel')}
            </label>
            <textarea
              dir="ltr"
              rows={7}
              value={ignoreText}
              onChange={(e) => setIgnoreText(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">
              {t('protectedPatternsLabel')}
            </label>
            <textarea
              dir="ltr"
              rows={7}
              value={protectedText}
              onChange={(e) => setProtectedText(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-xs font-mono"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {t('btnSaveSettings')}
        </button>
      </div>
    </form>
  );
};
