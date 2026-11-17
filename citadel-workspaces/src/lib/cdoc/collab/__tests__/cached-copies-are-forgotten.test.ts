/**
 * A document's decrypted local copy leaves the device when the server says the node is gone or
 * this account may no longer read it; a viewer who merely may not write keeps theirs. Real
 * replicas over the shared base; the cache is an in-memory DocumentCache (the IndexedDB adapter
 * is document-cache.test.ts's).
 */
import { describe, expect, it } from 'vitest';
import type { EditorSession } from '../../editor/editor-session';
import type { CachedDocument, DocumentCache } from '../ports';
import { CDOC_CRDT_DOC_VERSION } from '../relay-limits';
import { BOB, NODE, newDocument, openTab, type Tab } from './doubles/harness';
import { memoryDevice } from './doubles/memory-device';
import { baseSnapshot, realReplicas, typeInto } from './doubles/real-replicas';

type RealTab = Tab<EditorSession>;

async function cacheHoldingTheBase(failForget: boolean): Promise<{ cache: DocumentCache; saved: Map<string, CachedDocument> }> {
  const saved: Map<string, CachedDocument> = new Map<string, CachedDocument>([[NODE, { docVersion: CDOC_CRDT_DOC_VERSION, seq: 1n, snapshot: await baseSnapshot() }]]);
  const cache: DocumentCache = memoryDevice({
    load: (nodeId: string): Promise<CachedDocument | null> => Promise.resolve(saved.get(nodeId) ?? null),
    save: (nodeId: string, document: CachedDocument): Promise<void> => { saved.set(nodeId, document); return Promise.resolve(); },
    forget: (nodeId: string): Promise<void> => (failForget ? Promise.reject(new Error('storage unavailable')) : (saved.delete(nodeId), Promise.resolve())),
  }).cache;
  return { cache, saved };
}

async function bobWith(cache: DocumentCache, prepare: (kernel: Awaited<ReturnType<typeof newDocument>>['kernel']) => void): Promise<{ bob: RealTab; kernel: Awaited<ReturnType<typeof newDocument>>['kernel'] }> {
  const { kernel, clock } = await newDocument({});
  prepare(kernel);
  const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), cache);
  await bob.session.open();
  await kernel.settle([bob.session]);
  return { bob, kernel };
}

describe('the local copy of a document', () => {
  it('is removed when this account may no longer read the node', async () => {
    const { cache, saved } = await cacheHoldingTheBase(false);
    const { bob } = await bobWith(cache, (kernel) => kernel.deny(BOB, 'ViewContent'));
    expect(bob.problems.map((p) => p.problem.kind)).toEqual(['permissionDenied']);
    expect(saved.has(NODE)).toBe(false);
  });

  it('is removed when the server says the node does not exist', async () => {
    const { cache, saved } = await cacheHoldingTheBase(false);
    const { bob, kernel } = await bobWith(cache, () => {});
    kernel.inject(BOB, { Refused: { NoSuchNode: { node_id: NODE } } });
    await kernel.settle([bob.session]);
    expect(saved.has(NODE)).toBe(false);
  });

  it('stays when this account may read but not write', async () => {
    const { cache, saved } = await cacheHoldingTheBase(false);
    const { bob, kernel } = await bobWith(cache, (k) => k.deny(BOB, 'EditMdx'));
    await typeInto(bob.replica(), 'x');
    await kernel.settle([bob.session]);
    expect(bob.problems.map((p) => p.problem.kind)).toEqual(['permissionDenied']);
    expect(saved.has(NODE)).toBe(true);
  });

  it('reports a copy it could not remove', async () => {
    const { cache, saved } = await cacheHoldingTheBase(true);
    const { bob } = await bobWith(cache, (kernel) => kernel.deny(BOB, 'ViewContent'));
    expect(bob.problems.map((p) => p.problem)).toEqual([
      expect.objectContaining({ kind: 'permissionDenied' }),
      expect.objectContaining({ kind: 'cacheFailed', operation: 'forget' }),
    ]);
    expect(saved.has(NODE)).toBe(true);
  });
});
