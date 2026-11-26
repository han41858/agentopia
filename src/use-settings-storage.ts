import { useEffect } from 'react';
import {
  readSettings,
  settingsKey,
  settingsVersion,
  legacyRepositoryListKey,
} from './settings.ts';
import type { GitHubSettings } from './settings.ts';

export function useSettingsStorage(
  settings: GitHubSettings,
  restore: (next: GitHubSettings) => void,
) {
  useEffect(() => {
    try {
      localStorage.setItem(
        settingsKey,
        JSON.stringify({ version: settingsVersion, ...settings }),
      );
      localStorage.removeItem(legacyRepositoryListKey);
    } catch {
      // The current tab can still use the settings when storage is unavailable.
    }
  }, [settings]);

  useEffect(() => {
    function restoreSettings(event: StorageEvent) {
      if (
        event.storageArea !== localStorage ||
        (event.key !== null && event.key !== settingsKey)
      )
        return;
      const next = readSettings();
      restore(next);
    }
    window.addEventListener('storage', restoreSettings);
    return () => window.removeEventListener('storage', restoreSettings);
  }, [restore]);
}
