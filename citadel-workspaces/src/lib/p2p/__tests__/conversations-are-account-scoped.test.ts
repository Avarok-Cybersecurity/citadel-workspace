/**
 * Message pages were keyed by PEER ALONE, in LocalDB bucket 0n, which every
 * account on the device shares — on a product that expects several accounts in
 * one browser. Two accounts chatting with the same peer appended into the same
 * pages, so after a reload each one's private messages rendered in the other's
 * transcript.
 *
 * The `ownerCid` stamp only guarded deletion, so the second account's "Clear
 * Chat History" hit a debug-logged refusal: the screen emptied, the user was
 * told it could not be undone, and the history returned on reload.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

const cidRef: { current: bigint | null; } = { current: null as bigint | null };
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return cidRef.current; } }) };
});

import {
  conversationPrefix,
  legacyConversationPrefix,
  hasLegacyFallback,
} from '../message-page-keys';

const PEER: bigint = 999n;

describe('conversation storage keys', () => {
  beforeEach(() => { cidRef.current = null; });

  it('gives two accounts different keys for the same peer', () => {
    cidRef.current = 111n;
    const a: string = conversationPrefix(PEER);
    cidRef.current = 222n;
    const b: string = conversationPrefix(PEER);

    expect(a, 'both accounts wrote to the same conversation record').not.toBe(b);
  });

  it('includes both the owner and the peer, so neither collides', () => {
    cidRef.current = 111n;
    const key: string = conversationPrefix(PEER);
    expect(key).toContain('111');
    expect(key).toContain('999');
  });

  it('falls back to the legacy shape when there is no session yet', () => {
    // A record filed under a guessed account is worse than an unscoped one.
    expect(conversationPrefix(PEER)).toBe(legacyConversationPrefix(PEER));
    expect(hasLegacyFallback(PEER)).toBe(false);
  });

  it('reports a legacy fallback only when the key actually differs', () => {
    cidRef.current = 111n;
    expect(hasLegacyFallback(PEER)).toBe(true);
  });
});
