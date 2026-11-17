/**
 * Somebody asked to connect. That has to reach the screen.
 *
 * `handleIncomingRequest` pushed the request into memory, then awaited two
 * things before telling anyone: writing it to LocalDB, and reading the current
 * session CID. Either await throwing took the method with it, so `emitUpdate`
 * never ran — and the caller above logs and swallows. The app knew a request
 * existed and nothing on screen said so.
 *
 * That is not hypothetical here. LocalDB writes are refused when the ownership
 * gate cannot place the session (round 250 was one such refusal, on a key that
 * could never be written at all), and CI shows the far side polling twenty
 * times for a badge that never appears.
 *
 * The badge is how a person learns a request exists. Persistence is for
 * surviving a reload; failing at that must not also mean failing to mention it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const persist: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('../persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../persistence')>()),
  persistPendingToLocalDB: (...args: unknown[]): unknown => persist(...args),
}));

import { peerRegistrationStore } from '../service';
import { getCurrentSessionCid } from '../state';
import { eventEmitter } from '@/lib/event-emitter';

/** Announcements seen while running `body`. */
async function announcementsDuring(body: () => Promise<void>): Promise<number> {
  let seen: number = 0;
  const onUpdate = (): void => { seen += 1; };
  eventEmitter.on('peer-requests:updated', onUpdate);
  await body();
  eventEmitter.off('peer-requests:updated', onUpdate);
  return seen;
}

describe('an incoming request', () => {
  beforeEach(() => {
    persist.mockReset().mockResolvedValue(undefined);
  });

  it('is announced when everything works', async () => {
    const seen: number = await announcementsDuring(() =>
      peerRegistrationStore.handleIncomingRequest({ cid: 1n, peer_cid: 2n, peer_username: 'grace' }),
    );
    expect(seen).toBeGreaterThan(0);
  });

  it('is announced even when it cannot be stored', async () => {
    persist.mockRejectedValue(new Error('Session unavailable to this connection'));
    const seen: number = await announcementsDuring(() =>
      peerRegistrationStore.handleIncomingRequest({ cid: 1n, peer_cid: 3n, peer_username: 'ada' }),
    );
    expect(seen).toBeGreaterThan(0);
  });

  it('does not throw when the session cannot be read at all', async () => {
    // No IndexedDB in this environment, which is exactly the shape of a browser
    // with storage denied: the in-memory lookups miss and the fallback reads
    // storage. It must answer "unknown", not reject.
    await expect(getCurrentSessionCid()).resolves.toBeNull();
  });
});
