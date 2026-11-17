/**
 * One browser's accounts must not share a composer draft.
 *
 * The draft key was the conversation (peer CID) alone. Several accounts can
 * be logged in at once, and a ClaimSession switches which account a tab runs
 * as — so after a switch, the account you switched TO found the OTHER
 * account's half-written message sitting in its composer for the same peer.
 * Same hazard `scopedSettingsKey` (file-transfer/settings-key.ts) names, one
 * store over.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const currentCid: { value: bigint | null } = { value: 1n };
vi.mock('@/lib/multi-instance', () => ({
  instanceManager: {
    get cid(): bigint | null {
      return currentCid.value;
    },
  },
}));

const { saveDraft, loadDraft, clearDraft, clearAllDraftsForTests } = await import('../draft-store');

beforeEach(() => {
  currentCid.value = 1n;
  clearAllDraftsForTests();
});

describe('draft account scoping', () => {
  it('a draft does not follow a ClaimSession switch to another account', () => {
    saveDraft('peer-9', 'account one, mid-thought');

    currentCid.value = 2n; // ClaimSession: same tab, other account
    expect(loadDraft('peer-9')).toBe('');
  });

  // Opposite direction: scoping must not mean "store nothing" — the account
  // that typed the draft still finds it after switching away and back.
  it('the owning account still sees its own draft after switching back', () => {
    saveDraft('peer-9', 'account one, mid-thought');

    currentCid.value = 2n;
    currentCid.value = 1n;
    expect(loadDraft('peer-9')).toBe('account one, mid-thought');
  });

  it('clearing (or emptying) a draft under one account leaves the other account\'s intact', () => {
    saveDraft('peer-9', 'account one, mid-thought');
    currentCid.value = 2n;
    saveDraft('peer-9', 'account two, unrelated');

    clearDraft('peer-9');
    expect(loadDraft('peer-9')).toBe('');
    saveDraft('peer-9', ''); // the composer's own clear path
    currentCid.value = 1n;
    expect(loadDraft('peer-9')).toBe('account one, mid-thought');
  });

  // The convention's deliberate fallback: with no session yet, a draft
  // belongs to no account and lives under the bare conversation key.
  it('with no account known, drafts still work under the bare key', () => {
    currentCid.value = null;
    saveDraft('peer-9', 'typed before login');
    expect(loadDraft('peer-9')).toBe('typed before login');
    clearDraft('peer-9');
    expect(loadDraft('peer-9')).toBe('');
  });
});
