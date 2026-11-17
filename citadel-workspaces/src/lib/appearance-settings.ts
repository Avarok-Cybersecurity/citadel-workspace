/**
 * Personal appearance preferences, applied to the document.
 *
 * These lived inside the settings tab, which meant two things. Font Size was
 * applied in that tab's effect, so it took hold while Settings was open and
 * reverted on the next reload — the user's 18px choice looked like it had been
 * forgotten. And `compact-mode` / `reduce-motion` were toggled as root classes
 * that no stylesheet defined, alongside three preferences nothing read at all:
 * six controls, one of which half-worked.
 *
 * Everything here now has exactly one consumer path: this module writes the
 * document state, and CSS (or, for the sidebar, one custom property) reads it.
 * A preference with no reader does not belong in this file.
 */

import { isAnimationsPreference, type AnimationsPreference } from './motion-tier';
import { applyMotionPreference } from './motion-state';
import { readDeviceCapabilities } from './device-capabilities';

export interface AppearanceSettings {
  fontSize: number;
  sidebarWidth: 'narrow' | 'default' | 'wide';
  showAvatars: boolean;
  /** Auto, Full, Lite or Off; see motion-tier.ts. The document's classes are motion-state's. */
  animations: AnimationsPreference;
}

export const APPEARANCE_STORAGE_KEY: "citadel:appearance-settings" = 'citadel:appearance-settings';

export const defaultAppearanceSettings: AppearanceSettings = {
  fontSize: 14,
  sidebarWidth: 'default',
  showAvatars: true,
  animations: 'auto',
};

const SIDEBAR_WIDTHS: Record<AppearanceSettings['sidebarWidth'], string> = {
  narrow: '13rem',
  default: '16rem',
  wide: '20rem',
};

/** Bounds match the slider. A stored value outside them is not honoured. */
const MIN_FONT_SIZE: number = 12;
const MAX_FONT_SIZE: number = 18;

/**
 * Before Auto/Full/Lite/Off the choice was a switch, `animationsEnabled`. Off stays off; on was the only
 * motion there was, and becomes Auto, which is that same motion wherever the device keeps up with it.
 */
function storedAnimations(stored: { animations?: unknown; animationsEnabled?: unknown }): AnimationsPreference {
  if (isAnimationsPreference(stored.animations)) return stored.animations;
  return stored.animationsEnabled === false ? 'off' : defaultAppearanceSettings.animations;
}

function coerce(stored: unknown): AppearanceSettings {
  const merged: AppearanceSettings = { ...defaultAppearanceSettings, ...(stored as Partial<AppearanceSettings>) };
  const fontSize: number = Number(merged.fontSize);
  return {
    fontSize:
      Number.isFinite(fontSize) && fontSize >= MIN_FONT_SIZE && fontSize <= MAX_FONT_SIZE
        ? fontSize
        : defaultAppearanceSettings.fontSize,
    sidebarWidth: merged.sidebarWidth in SIDEBAR_WIDTHS
      ? merged.sidebarWidth
      : defaultAppearanceSettings.sidebarWidth,
    showAvatars: merged.showAvatars !== false,
    animations: storedAnimations(typeof stored === 'object' && stored !== null ? stored : {}),
  };
}

export function loadAppearanceSettings(): AppearanceSettings {
  try {
    const stored: string | null = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored) return coerce(JSON.parse(stored));
  } catch {
    // A corrupt value must not take the app's font size with it.
  }
  return defaultAppearanceSettings;
}

/**
 * Write the preferences onto the document.
 *
 * Called at boot, before first paint, and again on every change — the boot call
 * is what was missing, and it is the whole reason Font Size appeared to forget
 * itself between sessions.
 */
export function applyAppearanceSettings(settings: AppearanceSettings): void {
  const root: HTMLElement = document.documentElement;
  root.style.fontSize = `${settings.fontSize}px`;
  root.style.setProperty('--appearance-sidebar-width', SIDEBAR_WIDTHS[settings.sidebarWidth]);
  applyMotionPreference(settings.animations, readDeviceCapabilities(navigator));
  // An attribute rather than a class: it reads as state, and the CSS rule that
  // consumes it sits next to the reduced-motion block it mirrors.
  root.dataset.avatars = settings.showAvatars ? 'on' : 'off';
}

export function saveAppearanceSettings(settings: AppearanceSettings): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode, or a full quota. The preference still applies to this
    // session; failing to persist it is not a reason to refuse to honour it.
  }
  applyAppearanceSettings(settings);
}
