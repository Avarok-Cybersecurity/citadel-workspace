/**
 * What the browser lets a page ask for itself, and what it does not. A permission a page can
 * prompt for is prompted; one it cannot is explained, in the browser's own words, rather than
 * offered as a button that does nothing.
 */
import type { BrowserPermission } from './route';

export type PermissionAsk =
  | { readonly kind: 'prompt'; readonly media: 'notifications' | 'camera' | 'microphone' }
  | { readonly kind: 'agent-setup' }
  | { readonly kind: 'explain'; readonly how: string };

const SITE_SETTINGS: string = 'Open the site settings (the icon left of the address bar)';

export const PERMISSION_ASK: { readonly [K in BrowserPermission]: PermissionAsk } = {
  notifications: { kind: 'prompt', media: 'notifications' },
  camera: { kind: 'prompt', media: 'camera' },
  microphone: { kind: 'prompt', media: 'microphone' },
  'loopback-network': { kind: 'agent-setup' },
  screen: { kind: 'explain', how: `${SITE_SETTINGS} and allow screen sharing, or allow it in your system's privacy settings, then try again.` },
  clipboard: { kind: 'explain', how: `${SITE_SETTINGS} and allow the clipboard, then try again.` },
  popups: { kind: 'explain', how: `${SITE_SETTINGS} and allow pop-ups and redirects, then try again.` },
  storage: { kind: 'explain', how: `${SITE_SETTINGS} and allow cookies and site data, then reload.` },
};
