/**
 * The bounds of an app's toolbar, in one place (the ABI names none): at most
 * MAX_TOOLBAR_ITEMS buttons, each with an id the host hands back in `ui_action` and a plain-text
 * label of at most MAX_TOOLBAR_LABEL_CHARS. A toolbar out of bounds is refused whole and the one
 * shown stays; nothing an app sends is ever markup. Pure.
 */
import type { Refused } from '../host/ports';
import type { ToolbarItem } from '../sdk/generated/ToolbarItem';
import { plainText } from '../manifest/manifest-rules-parts';

export const MAX_TOOLBAR_ITEMS: number = 8;
export const MAX_TOOLBAR_LABEL_CHARS: number = 32;
const ITEM_ID: RegExp = /^[A-Za-z0-9_-]{1,64}$/;

/** One button the host draws: what it says and what it reports when pressed. */
export interface ToolbarButton {
  readonly id: string;
  readonly label: string;
}

export type ToolbarReading = { readonly ok: true; readonly buttons: readonly ToolbarButton[] } | { readonly ok: false; readonly refused: Refused };

export function readToolbar(items: readonly ToolbarItem[]): ToolbarReading {
  if (items.length > MAX_TOOLBAR_ITEMS) return { ok: false, refused: { limit: 'toolbar_items' } };
  if (new Set(items.map((i: ToolbarItem) => i.id)).size !== items.length) return { ok: false, refused: { policy: 'toolbar_duplicate_id' } };
  for (const i of items) {
    if (!ITEM_ID.test(i.id)) return { ok: false, refused: { policy: 'toolbar_id' } };
    if (!plainText(i.label, MAX_TOOLBAR_LABEL_CHARS, false)) return { ok: false, refused: { policy: 'toolbar_label' } };
  }
  // icon_name has no icon set to name yet; the label is the button's text and its accessible name.
  return { ok: true, buttons: items.map((i: ToolbarItem): ToolbarButton => ({ id: i.id, label: i.label })) };
}
