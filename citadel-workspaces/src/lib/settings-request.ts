/**
 * A request to open Settings at a tab, from anywhere: the document's encryption lock asks for
 * Security. One store, answered by the top bar, which owns the Settings dialog
 * (use-settings-requests.ts) -- so a caller needs no Settings code, and no path from it to the
 * connection layer (the Docs harness is held to none: docs-harness-never-reaches-the-agent).
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { SettingsTab } from '@/components/SettingsModal';

/** The tab asked for and not yet opened; null when nothing is pending. */
export const settingsRequest: ValueStore<SettingsTab | null> = createValueStore<SettingsTab | null>('settings-request', null);

export const requestSettings = (tab: SettingsTab): void => settingsRequest.set(tab);
