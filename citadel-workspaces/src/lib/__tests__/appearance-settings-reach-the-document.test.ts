/**
 * Six appearance controls; one of them half-worked.
 *
 * `compact-mode` and `reduce-motion` were toggled as root classes that no
 * stylesheet defined. `showAvatars`, `messageGrouping` and `sidebarWidth` were
 * persisted and read by nothing anywhere in the tree. Font Size was applied in
 * the settings tab's own effect, so it took hold while Settings was open and
 * was never re-applied at boot -- a user's 18px choice reverted on every
 * reload until they reopened the tab.
 *
 * These tests assert the document state each surviving preference produces,
 * because that is the thing the CSS and the sidebar actually read. Asserting
 * that the value was stored would have passed throughout the entire period the
 * feature did nothing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearanceSettings,
  defaultAppearanceSettings,
  loadAppearanceSettings,
  saveAppearanceSettings,
} from '../appearance-settings';

const root: () => HTMLElement = (): HTMLElement => document.documentElement;

describe('appearance settings', () => {
  beforeEach(() => {
    localStorage.clear();
    root().removeAttribute('style');
    root().className = '';
    delete root().dataset.avatars;
  });

  it('puts the font size on the document', () => {
    applyAppearanceSettings({ ...defaultAppearanceSettings, fontSize: 18 });
    expect(root().style.fontSize).toBe('18px');
  });

  it('re-applies a stored font size without the settings tab being opened', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ fontSize: 17 }));

    // Exactly what main.tsx does at boot. Before this existed, the size was
    // only ever set from inside the tab's effect.
    applyAppearanceSettings(loadAppearanceSettings());

    expect(root().style.fontSize).toBe('17px');
  });

  it('publishes the sidebar width as the property the sidebar reads', () => {
    applyAppearanceSettings({ ...defaultAppearanceSettings, sidebarWidth: 'wide' });
    expect(root().style.getPropertyValue('--appearance-sidebar-width')).toBe('20rem');

    applyAppearanceSettings({ ...defaultAppearanceSettings, sidebarWidth: 'narrow' });
    expect(root().style.getPropertyValue('--appearance-sidebar-width')).toBe('13rem');
  });

  it('marks the document when avatars are hidden', () => {
    applyAppearanceSettings({ ...defaultAppearanceSettings, showAvatars: false });
    expect(root().dataset.avatars).toBe('off');

    applyAppearanceSettings({ ...defaultAppearanceSettings, showAvatars: true });
    expect(root().dataset.avatars).toBe('on');
  });

  it('marks the document off only for Off, and lite only for Lite', () => {
    const marks = (): [boolean, boolean] => [root().classList.contains('reduce-motion'), root().classList.contains('lite-motion')];
    applyAppearanceSettings({ ...defaultAppearanceSettings, animations: 'off' });
    expect(marks()).toEqual([true, false]);
    applyAppearanceSettings({ ...defaultAppearanceSettings, animations: 'lite' });
    expect(marks()).toEqual([false, true]);
    applyAppearanceSettings({ ...defaultAppearanceSettings, animations: 'full' });
    expect(marks()).toEqual([false, false]);
  });

  it('reads the old Animations switch as the choice it was: off stays off, on becomes Auto', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ animationsEnabled: false }));
    expect(loadAppearanceSettings().animations).toBe('off');
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ animationsEnabled: true }));
    expect(loadAppearanceSettings().animations).toBe('auto');
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ animations: 'lite', animationsEnabled: false }));
    expect(loadAppearanceSettings().animations).toBe('lite');
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ animations: 'turbo' }));
    expect(loadAppearanceSettings().animations).toBe('auto');
  });

  it('saving applies as well as persists', () => {
    saveAppearanceSettings({ ...defaultAppearanceSettings, fontSize: 12 });

    expect(root().style.fontSize).toBe('12px');
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}').fontSize).toBe(12);
  });

  it('ignores a stored font size outside the slider bounds', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ fontSize: 400 }));
    expect(loadAppearanceSettings().fontSize).toBe(defaultAppearanceSettings.fontSize);
  });

  it('survives a corrupt stored value', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'not json');
    expect(loadAppearanceSettings()).toEqual(defaultAppearanceSettings);
  });
});
