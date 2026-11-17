/**
 * The ui port of one zone: SetToolbar draws the app's buttons above its zone (zone-toolbar.ts,
 * within toolbar-model.ts's bounds). Menus, dialogs, toasts and height changes are not offered on
 * this page yet, and say so: each answers `{unavailable: "ui_<what>"}` rather than nothing.
 */
import type { PortAnswer, UiPort } from '../host/ports';
import { readToolbar, type ToolbarReading } from './toolbar-model';
import type { ZoneToolbar } from './zone-toolbar';

export function zoneUiPort(toolbar: ZoneToolbar): UiPort {
  return {
    SetToolbar: ({ items }): PortAnswer<null> => {
      const read: ToolbarReading = readToolbar(items);
      if (!read.ok) return { refused: read.refused };
      toolbar.set(read.buttons);
      return { ok: null };
    },
    OpenMenu: () => ({ refused: { unavailable: 'ui_menu' } }),
    ShowDialog: () => ({ refused: { unavailable: 'ui_dialog' } }),
    ShowToast: () => ({ refused: { unavailable: 'ui_toast' } }),
    RequestHeight: () => ({ refused: { unavailable: 'ui_height' } }),
  };
}
