import type { WorkspaceTheme, ThemePalette, ThemeTokenKey, ThemeMode, HslColor } from './theme-types';
import { deriveDarkPalette } from './palette-builder';
import { findPreset } from './presets';

/**
 * The rules for editing a theme.
 *
 * Kept pure and separate from the modal so the semantics — copy-on-edit,
 * rename permissions, derived-dark tracking — can be tested without rendering a
 * colour wheel.
 */

/**
 * Editing a preset produces a copy; editing a user theme edits it in place.
 *
 * Presets stay pristine so "put it back the way it was" is always available.
 * The copy is named "<preset> Copy", and repeated copies number themselves
 * rather than colliding.
 */
export function beginEdit(theme: WorkspaceTheme, existingNames: string[] = []): WorkspaceTheme {
  if (!theme.isPreset) return theme;

  return {
    ...theme,
    id: crypto.randomUUID(),
    name: uniqueName(`${theme.name} Copy`, existingNames),
    isPreset: false,
  };
}

/** "Nord Copy", then "Nord Copy 2" — never a duplicate the user cannot tell apart. */
export function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;

  for (let n: number = 2; n < 1000; n += 1) {
    const candidate: string = `${base} ${n}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base} ${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Set one token, returning a new theme.
 *
 * Editing a LIGHT token re-derives dark while dark is still derived, so the two
 * modes stay in step for a user who only cares about one of them. Editing a
 * DARK token marks dark as hand-authored, and from then on light edits leave it
 * alone — otherwise the next light change would silently discard the dark work.
 */
export function setToken(
  theme: WorkspaceTheme,
  mode: ThemeMode,
  token: ThemeTokenKey,
  color: HslColor,
): WorkspaceTheme {
  if (mode === 'dark') {
    return {
      ...theme,
      dark: { ...theme.dark, [token]: color },
      darkIsDerived: false,
    };
  }

  const light: ThemePalette = { ...theme.light, [token]: color };
  return {
    ...theme,
    light,
    dark: theme.darkIsDerived ? deriveDarkPalette(light) : theme.dark,
  };
}

/** Only non-presets can be renamed; presets are shared vocabulary. */
export function canRename(theme: WorkspaceTheme): boolean {
  return !theme.isPreset;
}

export function renameTheme(theme: WorkspaceTheme, name: string, existingNames: string[] = []): WorkspaceTheme {
  if (!canRename(theme)) return theme;

  const trimmed: string = name.trim();
  if (!trimmed) return theme;

  const others: string[] = existingNames.filter((n) => n !== theme.name);
  return { ...theme, name: uniqueName(trimmed, others) };
}

/**
 * Hand the dark palette back to derivation.
 *
 * The way out of "I customised dark, then changed light, and now they disagree"
 * — without it the only remedy would be recreating the theme.
 */
export function resetDarkToDerived(theme: WorkspaceTheme): WorkspaceTheme {
  return { ...theme, dark: deriveDarkPalette(theme.light), darkIsDerived: true };
}

/**
 * Restore a copy to the preset it came from, when that preset still exists.
 *
 * Returns the theme unchanged if it was not derived from a known preset, so the
 * caller can offer the action only where it means something.
 */
export function resetToPreset(theme: WorkspaceTheme): WorkspaceTheme | null {
  const base: string = theme.name.replace(/ Copy( \d+)?$/, '');
  const preset: WorkspaceTheme | undefined = findPreset(base.toLowerCase().replace(/\s+/g, '-'));
  if (!preset) return null;

  return { ...preset, id: theme.id, name: theme.name, isPreset: false };
}
