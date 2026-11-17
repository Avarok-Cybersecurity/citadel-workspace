/**
 * A store that could not read its keys is not initialised.
 *
 * `local-db-client` refuses to write any key that was never successfully read —
 * correctly, since every persist here writes the WHOLE list. `initialize()`
 * discarded the `LoadOutcome` of both loads and set `isInitializedFlag = true`
 * regardless, so a read that failed at startup left the store believing it was
 * ready while every later write was refused with
 *
 *     Refusing to write outgoing: '…' was never successfully read
 *
 * — for the life of the tab, with nothing retrying and nothing on screen. A
 * peer request that cannot be persisted is a peer request the other side never
 * learns about. That exact line appears in the CI logs of the failing P2P specs.
 *
 * The poll loop re-reads the OUTGOING key each tick, so that half can recover —
 * but only in the leader tab, and only for that one key. The pending key was
 * read exactly once, ever.
 *
 * The rule: latch only when both keys were actually read, so the next
 * `initialize()` retries.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** 'answer' resolves the KV read; 'silent' never answers, so it times out. */
let readBehaviour: 'answer' | 'silent' = 'answer';
const sent: Record<string, unknown>[] = [];

vi.mock('../../websocket-service', (): { websocketService: Record<string, unknown> } => ({
  websocketService: {
    sendMessage: (message: Record<string, unknown>): Promise<void> => {
      sent.push(message);
      return Promise.resolve();
    },
  },
}));

// The loaders resolve through this module's pending-request map; driving the
// real timeout would cost the suite its own wall-clock, so the OUTCOME is
// supplied here and the assertion is about what `initialize()` does with it.
vi.mock('../persistence', (): Record<string, unknown> => ({
  loadPendingFromLocalDB: (): Promise<string> =>
    Promise.resolve(readBehaviour === 'answer' ? 'absent' : 'failed'),
  loadOutgoingFromLocalDB: (): Promise<string> =>
    Promise.resolve(readBehaviour === 'answer' ? 'absent' : 'failed'),
  persistPendingToLocalDB: (): Promise<void> => Promise.resolve(),
  persistOutgoingToLocalDB: (): Promise<void> => Promise.resolve(),
}));

// `isInitializedFlag` is private and reaches the outside world only as a
// callback handed to setupEventListeners. Capturing it here observes the real
// flag without adding a getter to production for a test's convenience.
// `vi.hoisted`, because `vi.mock` factories are hoisted above ordinary `let`
// declarations and would otherwise read the binding before it exists.
const captured: { readFlag: (() => boolean) | null } = vi.hoisted(
  (): { readFlag: (() => boolean) | null } => ({ readFlag: null }),
);
vi.mock('../event-handlers', (): Record<string, unknown> => ({
  setupEventListeners: (callbacks: { isInitialized: () => boolean }): void => {
    captured.readFlag = callbacks.isInitialized;
  },
}));

import { PeerRegistrationStore } from '../service';

/** A fresh store, and the live view of its initialisation flag. */
function freshStore(): { store: PeerRegistrationStore; isInitialised: () => boolean } {
  const store: PeerRegistrationStore = new (PeerRegistrationStore as unknown as {
    new (): PeerRegistrationStore;
  })();
  const flag: (() => boolean) | null = captured.readFlag;
  if (!flag) throw new Error('setupEventListeners was not called — the harness is wrong');
  return { store, isInitialised: flag };
}

describe('initialisation after a read that failed', () => {
  beforeEach((): void => {
    sent.length = 0;
    readBehaviour = 'answer';
  });

  it('does not report itself initialised when a key could not be read', async () => {
    readBehaviour = 'silent';
    const { store, isInitialised } = freshStore();

    await store.initialize();

    expect(isInitialised()).toBe(false);
  });

  it('retries on the next call, and latches once the read succeeds', async () => {
    readBehaviour = 'silent';
    const { store, isInitialised } = freshStore();
    await store.initialize();
    expect(isInitialised()).toBe(false);

    // The point of not latching: the next attempt must actually re-read rather
    // than short-circuit on the flag.
    readBehaviour = 'answer';
    await store.initialize();

    expect(isInitialised()).toBe(true);
  });

  it('latches when both keys are merely ABSENT', async () => {
    // The discrimination control. Absence is a complete picture of nothing and
    // must count as read — otherwise a first-run user never initialises at all,
    // which is a worse failure than the one being fixed.
    const { store, isInitialised } = freshStore();

    await store.initialize();

    expect(isInitialised()).toBe(true);
  });
});
