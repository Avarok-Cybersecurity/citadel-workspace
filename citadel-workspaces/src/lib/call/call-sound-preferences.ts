/**
 * The one place the call-sound preference lives.
 *
 * Both the settings UI and the sound player read through here, so the toggle
 * and the behaviour can never disagree. Read on demand from localStorage, so
 * nothing needs to be told when it changes.
 */

const STORAGE_KEY: "citadel:call-sound-settings" = 'citadel:call-sound-settings';

export interface CallSoundSettings {
  enabled: boolean;
}

// Default ON is a product decision, not a convenience: a call that rings
// silently is a missed call, and the user has had no chance to opt out yet.
const defaultSettings: CallSoundSettings = { enabled: true };

export function loadCallSoundSettings(): CallSoundSettings {
  try {
    const stored: string | null = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...defaultSettings, ...(JSON.parse(stored) as Partial<CallSoundSettings>) };
  } catch {
    // Corrupt storage must not take sounds down with it.
  }
  return defaultSettings;
}

export function saveCallSoundSettings(settings: CallSoundSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
