/**
 * What a Live Doc's status says: whether it is in step, getting there, or
 * waiting for the other person to come back.
 *
 * "Syncing..." with a pulsing dot stood indefinitely while the other person was
 * offline (live, 2026-09-29) -- activity claimed where there was only waiting.
 * Edits are kept locally and exchanged over the P2P link, so what decides the
 * wording is whether that link is up, not presence: presence starts as
 * "Offline" before anyone has reported it, which would call an online peer
 * offline.
 */
export type EditorSyncState = 'connecting' | 'syncing' | 'synced';

export interface LiveDocSyncLabel {
  text: string;
  tone: 'success' | 'warning' | 'muted';
  pulsing: boolean;
}

export function liveDocSyncLabel(state: EditorSyncState, linkUp: boolean, peerName: string): LiveDocSyncLabel {
  if (state === 'synced') return { text: 'Synced', tone: 'success', pulsing: false };
  if (!linkUp) return { text: `Waiting for ${peerName} — your edits sync when you connect`, tone: 'muted', pulsing: false };
  if (state === 'syncing') return { text: 'Syncing...', tone: 'warning', pulsing: true };
  return { text: 'Connecting...', tone: 'muted', pulsing: false };
}
