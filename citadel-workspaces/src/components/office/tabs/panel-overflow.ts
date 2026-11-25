/**
 * The overflow policy of a node pane's tab panels (NodeTabs), in one place.
 *
 * A panel is given the pane's height, and whatever it holds that is taller or wider than that
 * scrolls inside it, on both axes. Nothing a panel holds is clipped: a first-party app draws page
 * content of any length (the Calendar's notification settings, its event form), and a worker app's
 * host has a floor taller than a short phone. A panel is a flex column, so content that fills it
 * rather than growing (`min-h-0 flex-1`, a canvas host) still fills it, and scrolls nothing.
 *
 * The one exception is chat: it owns its scrollers (the message list scrolls, the composer stays
 * at the bottom), so its panel clips and never scrolls as a whole.
 */
import type { NodeTab } from '@/lib/node-tabs/tab-list';

/** A pane's body that scrolls what it holds; also the body of an app's own page (AppNodePage) when it shows no tabs. */
export const SCROLLING_PANE: string = 'flex min-h-0 min-w-0 flex-1 flex-col overflow-auto';
const SCROLLS: string = `mt-0 ${SCROLLING_PANE}`;
const OWNS_ITS_SCROLL: string = 'mt-0 flex-1 overflow-hidden';

export function panelOverflowClass(kind: NodeTab['kind']): string {
  return kind === 'chat' ? OWNS_ITS_SCROLL : SCROLLS;
}
