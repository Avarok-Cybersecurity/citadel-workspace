/**
 * The log, applied in order, never leaves an operation waiting for a unit the replica lacks. An
 * update that does (here one whose author's earlier update never reached the log) is reported
 * by name, the unit it waits for included, rather than silently held; one that does not is not.
 * Real replicas.
 */
import { describe, expect, it } from 'vitest';
import type { EditorSession } from '../../editor/editor-session';
import { CDOC_CRDT_DOC_VERSION } from '../relay-limits';
import { toWire } from '../wire-bytes';
import { ALICE, BOB, NODE, newDocument, openTab, type Tab } from './doubles/harness';
import { baseSnapshot, realReplicas, typeInto } from './doubles/real-replicas';

type RealTab = Tab<EditorSession>;

describe('an applied update that leaves operations waiting', () => {
  it('is reported with the unit they wait for, and the update that fills the gap is not', async () => {
    const { kernel, clock } = await newDocument({});
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await bob.session.open();
    await kernel.settle([bob.session]);
    // An author outside the log: its first keystroke is lost, its second arrives.
    const author: EditorSession = await realReplicas().open({ kind: 'snapshot', snapshot: await baseSnapshot() });
    const before: Uint8Array = await author.stateVector();
    await typeInto(author, 'x');
    const first: Uint8Array = await author.encodeDiff(before);
    const afterFirst: Uint8Array = await author.stateVector();
    await typeInto(author, 'y');
    const second: Uint8Array = await author.encodeDiff(afterFirst);

    kernel.inject(BOB, { DocumentUpdated: { node_id: NODE, seq: 2n, doc_version: CDOC_CRDT_DOC_VERSION, update: toWire(second), author_cid: ALICE } });
    await kernel.settle([bob.session]);
    expect(bob.problems.map((p) => p.problem)).toEqual([
      { kind: 'updatesWaiting', operation: 'apply update 2', missing: { client: expect.any(BigInt), clock: expect.any(BigInt) }, dropped: 0n },
    ]);
    expect(bob.problems[0].message).toMatch(/^After it had to apply update 2, the editor holds operations that wait for client \d+ clock \d+$/);

    kernel.inject(BOB, { DocumentUpdated: { node_id: NODE, seq: 3n, doc_version: CDOC_CRDT_DOC_VERSION, update: toWire(first), author_cid: ALICE } });
    await kernel.settle([bob.session]);
    expect(bob.problems).toHaveLength(1);
  });
});
