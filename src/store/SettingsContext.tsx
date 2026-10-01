import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Secrets, Settings } from '../types';
import {
  DEFAULT_SETTINGS,
  loadSecrets,
  loadSettings,
  saveSecrets,
  saveSettings,
} from './settings';

interface SettingsContextValue {
  settings: Settings;
  secrets: Secrets;
  updateSettings: (patch: Partial<Settings>) => void;
  updateSecrets: (patch: Partial<Secrets>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [secrets, setSecrets] = useState<Secrets>(() => loadSecrets());

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveSecrets(secrets, settings.rememberKeys);
  }, [secrets, settings.rememberKeys]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      secrets,
      updateSettings: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
      updateSecrets: (patch) => setSecrets((prev) => ({ ...prev, ...patch })),
      resetSettings: () => setSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings),
    }),
    [settings, secrets],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 SettingsProvider 内使用');
  return ctx;
}
