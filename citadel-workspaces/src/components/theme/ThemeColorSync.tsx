import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { syncThemeColorMeta } from '@/lib/theme/theme-color-meta';

/**
 * Keeps the OS titlebar colour following the user's light/dark choice.
 *
 * applyTheme already syncs it whenever a WORKSPACE theme is written, but that
 * provider only wraps the authenticated app. Landing, login and join render
 * outside it, so without this the titlebar there would keep whatever index.html
 * declared — a purple bar above a white page for anyone in light mode, on the
 * first screen they ever see.
 *
 * Mounted under next-themes' provider and keyed on the RESOLVED theme, so
 * "system" is followed rather than reported: `theme` would read "system", which
 * is not a colour.
 */
export function ThemeColorSync(): null {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    // After paint: next-themes flips the `.dark` class in its own effect, and
    // reading the computed variable before that lands returns the outgoing
    // colour — the titlebar would then trail one toggle behind.
    const frame: number = requestAnimationFrame(() => syncThemeColorMeta());
    return (): void => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return null;
}
