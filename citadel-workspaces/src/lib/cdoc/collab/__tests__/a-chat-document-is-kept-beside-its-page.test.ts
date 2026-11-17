/**
 * A document shared in a node's chat is kept on this device beside the node's page, never in its
 * place: its copy, edits and choices are its own, and removing the node (deleted, or no longer
 * readable, on this account or on every account here) removes its chat documents' records with
 * the page's; a chat document forgotten alone (its own read refused) takes only its own.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CachedDocument, DocumentCache } from '../ports';
import type { EditorController } from '../../editor/controller';

const store: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('./doubles/memory-storage')).memoryStorageUtils(store));
// jsdom has no Web Locks API; the stand-in is memory-device.ts's, as in the cache's own tests.
vi.mock('../instance-locks', async () => {
  const { memoryLocks } = await import('./doubles/memory-device');
  return { browserInstanceLocks: memoryLocks };
});
// The signed-in session the ports are built for; nothing here sends.
vi.mock('@/lib/workspace-service', () => ({ default: { currentCid: 31n, sendProtocolRequest: (): Promise<void> => Promise.resolve() } }));

const { workspaceCollabPorts } = await import('../workspace-ports');
const { forgetDeletedNodes, forgetNodeDocuments } = await import('@/lib/document-replica-cache');

const ACCOUNT: bigint = 31n;
const DOC_A: string = 'cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b';
const PAGE: CachedDocument = { docVersion: 2, seq: 4n, snapshot: Uint8Array.from([1]) };
const CHAT: CachedDocument = { docVersion: 2, seq: 9n, snapshot: Uint8Array.from([2]) };

describe('a chat document on this device', () => {
  const cacheOf = (chatDoc: string | null): DocumentCache => {
    const cache: DocumentCache | null = workspaceCollabPorts((): Promise<EditorController> => Promise.reject(new Error('unused')), chatDoc).cache;
    if (cache === null) throw new Error('the app keeps documents on the device');
    return cache;
  };
  const account: DocumentCache = cacheOf(null);
  const chat: DocumentCache = cacheOf(DOC_A);

  it('keeps its own copy and edits beside the page\'s', async () => {
    await account.save('n1', PAGE);
    await chat.save('n1', CHAT);
    await chat.saveEdits('n1', 'tab-1', [Uint8Array.from([5])]);
    expect([await account.load('n1'), await chat.load('n1')]).toEqual([PAGE, CHAT]);
    expect(await account.loadEdits('n1')).toEqual([]);
  });

  it('goes when its node does, and a sibling node\'s stays', async () => {
    await chat.save('n1', CHAT);
    await chat.save('n2', CHAT);
    await forgetNodeDocuments(ACCOUNT, ['n1']);
    expect([await chat.load('n1'), await chat.load('n2')]).toEqual([null, CHAT]);
  });

  it('goes for every account when its node is deleted on the server', async () => {
    await chat.save('n1', CHAT);
    await forgetDeletedNodes(['n1']);
    expect(await chat.load('n1')).toBeNull();
  });

  it('forgotten alone, takes its own copy and edits and leaves the page\'s', async () => {
    await account.save('n1', PAGE);
    await chat.save('n1', CHAT);
    await chat.saveEdits('n1', 'tab-1', [Uint8Array.from([5])]);
    await chat.forget('n1');
    expect([await account.load('n1'), await chat.load('n1'), await chat.loadEdits('n1')]).toEqual([PAGE, null, []]);
  });
});
