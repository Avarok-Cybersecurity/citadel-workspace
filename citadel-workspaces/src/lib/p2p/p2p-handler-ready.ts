/**
 * Whether the P2P messenger's 'websocket-message' subscription is attached in
 * this tab, plus a holding area for messages that arrive before it is.
 *
 * `eventEmitter.listenerCount('websocket-message')` is NOT a substitute for
 * this flag, and that mistake is the reason this module exists. Several
 * unrelated services subscribe to the same event at module load — peer
 * registration, workspace responses, group responses, auto-connect — so the
 * count is nonzero long before the messenger, the one consumer P2P chat
 * messages exist for, has been constructed.
 *
 * That is not hypothetical. In CI run 32912073077 the message that went missing
 * was emitted twice to EIGHT listeners, and the tab's first P2P handler entry
 * appears afterwards, once the count had climbed to twelve. Gating on the count
 * would have looked correct and lost the message anyway.
 */

import { debugLog } from '@/lib/debug-config';

/**
 * How many messages to hold. Generous, because the window is milliseconds once
 * the messenger is constructed during boot, and bounded because a tab where it
 * somehow never attaches must not grow this forever.
 */
const MAX_HELD: number = 64;

/**
 * How long a message may wait for the handler before being emitted anyway.
 *
 * The hold exists to cover a boot window measured in milliseconds. If the
 * handler has not attached within this long it is probably not coming — a
 * failed import, a tab that never finishes booting — and delivering to whoever
 * IS listening beats holding forever. An unbounded hold would trade a rare lost
 * message for a permanently stranded one, which is not an improvement.
 */
const HOLD_RELEASE_MS: number = 2000;

let attached: boolean = false;
let held: unknown[] = [];
let replay: ((message: unknown) => void) | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * True while held messages are being re-delivered.
 *
 * A replay re-enters the same path that held it, so without this a timeout
 * release re-holds every message it just released — the buffer never drains
 * and the messages are stranded permanently, which is strictly worse than the
 * loss this module exists to prevent.
 */
let releasing: boolean = false;

/** Deliver everything held, whether or not the handler ever attached. */
function flushHeld(reason: string): void {
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (held.length === 0) return;
  // Taken before replaying: a replayed message routes through the same path
  // that could hold it, and re-entering a list being iterated is how a replay
  // loop starts.
  const queued: unknown[] = held;
  held = [];
  debugLog('P2PHandlerReady', `[ILM-Router] releasing ${queued.length} held message(s): ${reason}`);
  releasing = true;
  try {
    for (const message of queued) replay?.(message);
  } finally {
    releasing = false;
  }
}

/**
 * How held messages are re-delivered. Registered by the inbound router, which
 * owns the emit path.
 */
export function setP2PReplay(fn: (message: unknown) => void): void {
  replay = fn;
}

export function markP2PMessageHandlerAttached(): void {
  attached = true;
  flushHeld('handler attached');
}

export function isP2PMessageHandlerAttached(): boolean {
  return attached;
}

/**
 * Hold a message that would otherwise be emitted with nobody to receive it.
 *
 * Returns true when the caller must NOT emit — the message is now this
 * module's responsibility until the handler attaches.
 */
export function holdUntilP2PHandlerAttached(message: unknown): boolean {
  if (attached || releasing) return false;
  if (held.length >= MAX_HELD) {
    // Dropping the oldest rather than refusing the newest: if this many have
    // piled up the handler is not coming soon, and the recent messages are the
    // ones still worth delivering.
    held.shift();
    debugLog('P2PHandlerReady', `[ILM-Router] hold buffer full (${MAX_HELD}); dropped the oldest`);
  }
  held.push(message);
  if (releaseTimer === null) {
    releaseTimer = setTimeout(() => flushHeld('hold timeout; handler never attached'), HOLD_RELEASE_MS);
  }
  debugLog('P2PHandlerReady', `[ILM-Router] holding a message until the P2P handler attaches (held=${held.length})`);
  return true;
}

/** Test seam: reset module state between cases. */
export function resetP2PHandlerReadyForTests(): void {
  if (releaseTimer !== null) clearTimeout(releaseTimer);
  releaseTimer = null;
  releasing = false;
  attached = false;
  held = [];
  replay = null;
}
