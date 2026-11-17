/**
 * An app's toolbar, drawn by the host above its zone: real buttons, in the page's design tokens,
 * keyboard-reachable and named by their label, which is set as text and so can never be markup.
 * Each update replaces the buttons shown; an empty toolbar draws nothing. A press is reported to
 * the zone until the toolbar is disposed, and never after. After the buttons, a badge names the
 * plane the zone's internal HTTP last moved over (via-badge.ts), once there has been any.
 */
import type { Via } from '../sdk/generated/Via';
import type { ToolbarButton } from './toolbar-model';
import { VIA_BADGE } from './via-badge';

export interface ZoneToolbar {
  readonly element: HTMLElement;
  readonly set: (buttons: readonly ToolbarButton[]) => void;
  /** The plane a frame for the zone just arrived over. */
  readonly via: (via: Via) => void;
  readonly dispose: () => void;
}

const BADGE: string = 'inline-flex min-h-[44px] items-center rounded-full bg-muted px-[12px] text-[13px] text-muted-foreground';
const BUTTON: string = 'inline-flex min-h-[44px] min-w-[44px] max-w-full items-center justify-center rounded-md border border-border bg-background px-[12px] text-[14px] font-medium text-foreground break-words hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function zoneToolbar(doc: Document, appName: string, onPress: (id: string) => void): ZoneToolbar {
  const bar: HTMLDivElement = doc.createElement('div');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', `${appName} actions`);
  bar.dataset.testid = 'app-zone-toolbar';
  bar.className = 'mb-[8px] flex flex-wrap gap-[8px]';
  bar.style.display = 'none';
  const badge: HTMLSpanElement = doc.createElement('span');
  badge.dataset.testid = 'app-zone-via';
  badge.className = BADGE;
  let shown: HTMLButtonElement[] = [];
  let live: boolean = true;
  const draw = (): void => {
    const heard: boolean = badge.dataset.via !== undefined;
    bar.replaceChildren(...shown, ...(heard ? [badge] : []));
    bar.style.display = shown.length === 0 && !heard ? 'none' : '';
  };
  return {
    element: bar,
    set: (buttons: readonly ToolbarButton[]): void => {
      if (!live) return;
      shown = buttons.map((b: ToolbarButton): HTMLButtonElement => {
        const button: HTMLButtonElement = doc.createElement('button');
        button.type = 'button';
        button.textContent = b.label;
        button.className = BUTTON;
        button.dataset.testid = 'app-toolbar-item';
        button.dataset.itemId = b.id;
        button.addEventListener('click', (): void => { if (live) onPress(b.id); });
        return button;
      });
      draw();
    },
    via: (via: Via): void => {
      if (!live || badge.dataset.via === via) return;
      badge.dataset.via = via;
      badge.textContent = VIA_BADGE[via];
      draw();
    },
    dispose: (): void => {
      live = false;
      bar.remove();
    },
  };
}
