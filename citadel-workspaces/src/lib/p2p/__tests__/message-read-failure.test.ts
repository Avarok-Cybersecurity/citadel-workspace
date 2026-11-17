/**
 * A failed read must never be reported as an absent conversation.
 *
 * `sendLocalDBGet` rejects for BOTH "no such key" and "the request timed out"
 * / "the socket is down". Both used to come back as `null`, and the append
 * path reads `null` as "this conversation is new": it fabricates metadata with
 * `latestPage: 0` and writes a page holding just the message that triggered
 * it. That overwrites page 0 and orphans pages 1..N, because `latestPage` is
 * the only record that they exist. One 5-second timeout silently destroyed a
 * conversation, with nothing above debugLog to say so.
 */
import { describe, it, expect, vi, beforeEach  } from 'vitest';

const sendLocalDBGet: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: (...args: unknown[]): unknown => sendLocalDBGet(...args),
    sendLocalDBSet: vi.fn().mockResolvedValue(undefined),
    sendLocalDBDelete: vi.fn().mockResolvedValue(undefined),
  },
}));

const { loadMetadata, tryLoadMetadata } = await import('../message-page-operations');

describe('a read that fails is not a conversation that is absent', () => {
  // Scoped to OUR key. websocket-service is imported transitively by the
  // leader-election machinery, which issues its own reads on import — a blanket
  // rejecting mock turns those into unrelated unhandled rejections that fail
  // the run before any assertion is reached.
  function failWith(message: string): void {
    sendLocalDBGet.mockImplementation(async (_ns: unknown, key: string) => {
      if (typeof key === 'string' && key.includes('7_metadata')) throw new Error(message);
      return { value: null };
    });
  }

  beforeEach(() => sendLocalDBGet.mockReset());

  it('reports genuine absence as null', async () => {
    failWith('Key not found');
    await expect(loadMetadata(7n)).resolves.toBeNull();
  });

  it('throws when the read itself failed', async () => {
    // The case that cost the data: indistinguishable from the above until now.
    failWith('LocalDBGetKV request timed out');
    await expect(loadMetadata(7n)).rejects.toThrow(/timed out/);
  });

  it('throws when the transport is down', async () => {
    failWith('Failed to initialize WASM client');
    await expect(loadMetadata(7n)).rejects.toThrow(/WASM/);
  });

  it('offers an explicitly tolerant read for callers that cannot lose data', async () => {
    // updateUnreadCount and friends: "could not read" and "not there" lead to
    // the same harmless skip, so they opt in by name rather than by accident.
    failWith('LocalDBGetKV request timed out');
    await expect(tryLoadMetadata(7n)).resolves.toBeNull();
  });
});
