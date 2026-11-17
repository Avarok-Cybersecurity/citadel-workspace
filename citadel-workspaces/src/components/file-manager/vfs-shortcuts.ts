/**
 * The file manager's keyboard shortcuts: which keys, and how to name them.
 *
 * The handler matched literal keys and nothing on screen mentioned any of them,
 * so F2, Delete and Ctrl+X/C/V/A worked for whoever already guessed they might.
 * The keys and their labels now come from this one table, so a menu cannot
 * advertise a key the handler does not answer.
 */

export interface VfsShortcut {
  /** `KeyboardEvent.key` values that trigger it. */
  keys: readonly string[];
  /** Ctrl on Windows/Linux, Cmd on Apple platforms. */
  mod: boolean;
}

export const VFS_SHORTCUTS: {
  readonly preview: VfsShortcut; readonly download: VfsShortcut;
  readonly rename: VfsShortcut; readonly remove: VfsShortcut; readonly cut: VfsShortcut;
  readonly copy: VfsShortcut; readonly paste: VfsShortcut; readonly selectAll: VfsShortcut;
  readonly clear: VfsShortcut;
} = {
  /** Answered by the item itself: Space selects it, and a selected item is in the inspector. */
  preview: { keys: [' '], mod: false },
  download: { keys: ['d'], mod: true },
  rename: { keys: ['F2'], mod: false },
  remove: { keys: ['Delete', 'Backspace'], mod: false },
  cut: { keys: ['x'], mod: true },
  copy: { keys: ['c'], mod: true },
  paste: { keys: ['v'], mod: true },
  selectAll: { keys: ['a'], mod: true },
  clear: { keys: ['Escape'], mod: false },
};

export function matchesShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>, s: VfsShortcut): boolean {
  const mod: boolean = e.ctrlKey || e.metaKey;
  return mod === s.mod && s.keys.includes(e.key);
}

export function isApplePlatform(nav: Pick<Navigator, 'platform' | 'userAgent'>): boolean {
  return /Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent);
}

/** What a menu shows beside the action: "Ctrl+X", "⌘X", "F2", "Del", "Space". */
function keyName(key: string): string {
  if (key === 'Delete') return 'Del';
  return key === ' ' ? 'Space' : key.toUpperCase();
}

export function shortcutLabel(s: VfsShortcut, apple: boolean): string {
  const key: string = keyName(s.keys[0]);
  if (!s.mod) return key;
  return apple ? `⌘${key}` : `Ctrl+${key}`;
}

/** The same, in `aria-keyshortcuts` syntax, so assistive tech can announce it. */
export function ariaShortcut(s: VfsShortcut, apple: boolean): string {
  const key: string = s.keys[0] === ' ' ? 'Space' : s.keys[0];
  return s.mod ? `${apple ? 'Meta' : 'Control'}+${key.toUpperCase()}` : key;
}

/**
 * Whether a keydown belongs to something else on the page.
 *
 * Inputs were already excluded. Dialogs and menus were not: with the delete
 * confirmation or the properties dialog open, Delete or Backspace reached this
 * handler through the dialog and asked to delete the selection behind it again.
 */
export function isForeignKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
  return target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null;
}
