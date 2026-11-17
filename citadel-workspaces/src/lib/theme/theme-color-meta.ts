import { fromCssValue, toHex } from './hsl';
import type { HslColor } from '@/lib/theme/theme-types';

/**
 * Keeping `<meta name="theme-color">` in step with the applied theme.
 *
 * That tag paints the OS status bar and the installed window's titlebar — the
 * one piece of the app's surface the app does not draw itself. It shipped as a
 * literal `#6E59A5` that nothing ever updated, so an installed PWA wore the
 * Avarok purple no matter which theme the workspace chose, and in light mode a
 * purple band sat above white content.
 *
 * Read from the COMPUTED variable rather than from a palette object, because
 * that is the only value that reflects all three inputs at once: the
 * stylesheet's defaults, the workspace theme applyTheme wrote, and the `.dark`
 * class next-themes controls. Deriving it from any single one of those would be
 * right only until the other two disagreed.
 *
 * Emits hex rather than `hsl(H S% L%)`: the space-separated form is CSS Color 4
 * and support in meta-tag parsing is less certain than in stylesheets, where a
 * failure would be silent and only visible on a device.
 */
export function syncThemeColorMeta(
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root || typeof document === 'undefined') return;

  const meta: Element | null = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;

  const raw: string = getComputedStyle(root).getPropertyValue('--background').trim();
  const color: HslColor | null = fromCssValue(raw);
  // Leave the markup's value alone rather than writing something unparseable:
  // a wrong titlebar is worse than a stale one.
  if (!color) return;

  meta.setAttribute('content', toHex(color));
}
