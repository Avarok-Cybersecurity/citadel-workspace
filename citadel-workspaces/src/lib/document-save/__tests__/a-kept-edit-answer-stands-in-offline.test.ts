/**
 * With the link down, the last edit answer the server gave this account here stands: a kept
 * yes opens the document for editing, a kept no or none keeps it read only, and any real
 * answer wins over what was kept. The answer is kept with the document's records and removed
 * with them. Storage is the IndexedDB stand-in (memory-storage.ts); the rest is production.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ActionGate, UsePermissionResult } from '@/hooks/use-permission-result';

const store: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(store));

const { isServerAnswer, lastKnownEditAnswer, offlineEditGate, rememberEditAnswer } = await import('../last-known-access');
const { forgetAccountDocuments, forgetDeletedNodes, localRecordPut, documentAccessKey } = await import('@/lib/document-replica-cache');

const answer = (state: Partial<UsePermissionResult>): UsePermissionResult => ({
  allowed: false, loading: false, reason: null, unanswered: false, answered: true, refresh: (): Promise<void> => Promise.resolve(), ...state,
});
const UNANSWERED: UsePermissionResult = answer({ unanswered: true, answered: false });
const LIVE_NO: ActionGate = { enabled: false, reason: 'Your permissions here could not be checked. Reconnect and try again.' };

describe('the edit answer kept on this device', () => {
  it('is read back as kept, per account and node', async () => {
    store.clear();
    await rememberEditAnswer(1n, 'doc', true);
    expect(await lastKnownEditAnswer(1n, 'doc')).toBe(true);
    expect(await lastKnownEditAnswer(2n, 'doc')).toBeNull();
    await rememberEditAnswer(1n, 'doc', false);
    expect(await lastKnownEditAnswer(1n, 'doc')).toBe(false);
  });

  it('calls a malformed record an error, not "no answer"', async () => {
    store.clear();
    await localRecordPut(documentAccessKey(1n, 'doc'), { canEdit: 'yes' });
    await expect(lastKnownEditAnswer(1n, 'doc')).rejects.toThrow('not in the shape');
  });

  it('goes with the document when it is deleted, and with the account at sign-out', async () => {
    store.clear();
    await rememberEditAnswer(1n, 'gone', true);
    await rememberEditAnswer(1n, 'kept', true);
    await forgetDeletedNodes(['gone']);
    expect(await lastKnownEditAnswer(1n, 'gone')).toBeNull();
    expect(await lastKnownEditAnswer(1n, 'kept')).toBe(true);
    await forgetAccountDocuments(1n);
    expect(await lastKnownEditAnswer(1n, 'kept')).toBeNull();
  });
});

describe('the edit gate', () => {
  it('opens on a kept yes when the server could not be asked', () => {
    expect(offlineEditGate(UNANSWERED, true, LIVE_NO)).toEqual({ enabled: true, reason: null });
  });

  it('stays as the live gate on a kept no, on none, and on any real answer', () => {
    expect(offlineEditGate(UNANSWERED, false, LIVE_NO)).toBe(LIVE_NO);
    expect(offlineEditGate(UNANSWERED, null, LIVE_NO)).toBe(LIVE_NO);
    const refused: ActionGate = { enabled: false, reason: "You don't have permission to edit this content" };
    expect(offlineEditGate(answer({ allowed: false }), true, refused)).toBe(refused);
  });

  it('keeps only the server\'s own answers, never a loading or unanswered one', () => {
    expect(isServerAnswer(answer({ allowed: true }))).toBe(true);
    expect(isServerAnswer(answer({ allowed: false }))).toBe(true);
    expect(isServerAnswer(answer({ loading: true }))).toBe(false);
    expect(isServerAnswer(UNANSWERED)).toBe(false);
    expect(isServerAnswer(answer({ answered: false }))).toBe(false);
  });
});
