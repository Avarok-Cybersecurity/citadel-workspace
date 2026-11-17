import { debugLog } from '@/lib/debug-config';

/**
 * When the user last used a given session.
 *
 * The backend has no notion of which of your sessions you looked at most
 * recently, so this is a purely local ordering hint for the session switcher.
 *
 * One module because the key was being built by hand in four places — three
 * writers and one reader — as a template literal. Two of them stringified the
 * CID explicitly and two interpolated it directly, which happens to produce the
 * same text for a bigint but is exactly the kind of near-miss that eventually
 * writes one key and reads another.
 */
function keyFor(cid: bigint | string): string {
  return `session_last_accessed_${cid.toString()}`;
}

export function readLastAccessed(cid: bigint | string): number {
  try {
    return parseInt(localStorage.getItem(keyFor(cid)) || '0', 10);
  } catch {
    // Private mode or blocked storage. An unknown last-used time sorts last,
    // which is the same as never having used it — no reason to fail a render.
    return 0;
  }
}

export function markLastAccessed(cid: bigint | string): void {
  try {
    localStorage.setItem(keyFor(cid), Date.now().toString());
  } catch (e) {
    debugLog('LastAccessed', 'lastAccessed write failed (non-critical):', e);
  }
}
