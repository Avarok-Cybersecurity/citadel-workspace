import type { ThemeTokenKey } from './theme-types';

/**
 * The parts of the miniature workspace, and which token each one edits.
 *
 * The preview is the editor: rather than a list of 26 named swatches, the user
 * clicks the thing they want to change on a small picture of their own
 * workspace. That only works if every visible part maps to exactly one token —
 * otherwise clicking the sidebar would be ambiguous about which colour it means.
 *
 * Kept as data, and separate from the rendering, so the mapping can be asserted
 * without a DOM: every region names a real token, no token is claimed twice, and
 * nothing meaningful is left unreachable.
 */

export interface PreviewRegion {
  id: string;
  /** Shown on hover and as the control's accessible name. */
  label: string;
  /** What this colour is FOR, so the user can tell primary from accent. */
  description: string;
  token: ThemeTokenKey;
}

/**
 * Ordered roughly as the eye travels the real layout: chrome, then navigation,
 * then content, then controls.
 */
export const PREVIEW_REGIONS: PreviewRegion[] = [
  {
    id: 'page',
    label: 'Page background',
    description: 'The deepest surface, behind everything else.',
    token: 'background',
  },
  {
    id: 'topbar',
    label: 'Top bar',
    description: 'The workspace header, and every card in the app.',
    token: 'card',
  },
  {
    id: 'sidebar',
    label: 'Sidebar',
    description: 'Raised surfaces: menus, hover states, selected rows.',
    token: 'surface',
  },
  {
    id: 'active-item',
    label: 'Selected item',
    description: 'The brand fill, used for primary buttons and the current selection.',
    token: 'primary',
  },
  {
    id: 'accent',
    label: 'Accent',
    description: 'The brighter brand tone, for links, icons and focus rings.',
    token: 'primaryAccent',
  },
  {
    id: 'body-text',
    label: 'Body text',
    description: 'Main text colour.',
    token: 'foreground',
  },
  {
    id: 'muted-text',
    label: 'Secondary text',
    description: 'Timestamps, hints and captions.',
    token: 'mutedForeground',
  },
  {
    id: 'border',
    label: 'Borders',
    description: 'Dividers, outlines and input edges.',
    token: 'border',
  },
  {
    id: 'destructive',
    label: 'Danger',
    description: 'Destructive actions and error states.',
    token: 'destructive',
  },
  {
    id: 'success',
    label: 'Success',
    description: 'Confirmations and online indicators.',
    token: 'success',
  },
  {
    id: 'warning',
    label: 'Warning',
    description: 'Cautions and pending states.',
    token: 'warning',
  },
];

export function findRegion(id: string): PreviewRegion | undefined {
  return PREVIEW_REGIONS.find((r) => r.id === id);
}

/**
 * Tokens no region edits directly.
 *
 * Foregrounds that sit on a fill (`primaryForeground`, `destructiveForeground`)
 * are chosen for contrast rather than picked, and the paired surfaces
 * (`popover`, `secondary`, `muted`, `accent`) follow `card` and `surface`. They
 * are listed rather than merely absent so the omission reads as a decision, and
 * so the test that checks coverage has something to check against.
 */
export const NON_EDITABLE_TOKENS: ThemeTokenKey[] = [
  'cardForeground',
  'popover',
  'popoverForeground',
  'surfaceForeground',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'accent',
  'accentForeground',
  'destructiveForeground',
  'successForeground',
  'warningForeground',
  'input',
  'ring',
];
