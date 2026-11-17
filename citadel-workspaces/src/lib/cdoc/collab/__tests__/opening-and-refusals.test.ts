/**
 * Opening reads the whole log in order, page by page and over a snapshot; what the server
 * refuses, denies, or sends in a format this client does not read is reported, never dropped.
 * Real replicas; the log starts from one shared base at seq 1 (doubles/real-replicas.ts).
 */
import { DOCUMENTS_RELAY_LIMITS } from '../relay-limits';
import { describe, expect, it } from 'vitest';
import type { EditorSession } from '../../editor/editor-session';
import { CDOC_CRDT_DOC_VERSION } from '../relay-limits';
import { ALICE, BOB, NODE, converged, newDocument, openTab, type Tab } from './doubles/harness';
import { realReplicas, snapshotText, typeInto } from './doubles/real-replicas';

type RealTab = Tab<EditorSession>;

describe('opening a document', () => {
  it('pulls page after page until has_more is false, then holds every update in order', async () => {
    const { kernel, clock } = await newDocument({ maxUpdatesPerPull: 2 });
    const writer: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
    await writer.session.open();
    await kernel.settle([writer.session]);
    await typeInto(writer.replica(), 'hello');
    await kernel.settle([writer.session]);

    const reader: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await reader.session.open();
    await kernel.settle([reader.session]);
    const since: bigint[] = kernel.sentOf('Pull').filter((r: { cid: bigint }): boolean => r.cid === BOB).map((r: { request: { Pull: { since_seq: bigint } } }): bigint => r.request.Pull.since_seq);
    expect(since).toEqual([0n, 3n, 5n]);
    expect(await snapshotText(reader.replica())).toContain('hello');
    expect(await converged([writer, reader])).toBe(true);
  });

  it('opens over the stored snapshot, then applies only the updates after it', async () => {
    const { kernel, clock } = await newDocument({});
    const writer: RealTab = openTab(kernel, clock, ALICE, { snapshotAfterLocalUpdates: 3 }, realReplicas(), null);
    await writer.session.open();
    await kernel.settle([writer.session]);
    await typeInto(writer.replica(), 'abc');
    await kernel.settle([writer.session]);
    await typeInto(writer.replica(), 'de');
    await kernel.settle([writer.session]);
    expect(kernel.log.snapshotUpto).toBe(4n);

    const reader: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await reader.session.open();
    await kernel.settle([reader.session]);
    expect(reader.sources).toHaveLength(1);
    expect('snapshot' in reader.sources[0]).toBe(true);
    expect(await snapshotText(reader.replica())).toContain('abcde');
    expect(reader.session.seq).toBe(6n);
  });

  it('re-opens over a newer snapshot while open, keeping its unacknowledged edits', async () => {
    const { kernel, clock } = await newDocument({});
    const alice: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
    const bob: RealTab = openTab(kernel, clock, BOB, { snapshotAfterLocalUpdates: 4 }, realReplicas(), null);
    await alice.session.open();
    await bob.session.open();
    await kernel.settle([alice.session, bob.session]);

    kernel.setLink(ALICE, 'down');
    await typeInto(bob.replica(), 'bbbb');
    await kernel.settle([alice.session, bob.session]);
    expect(kernel.log.snapshotUpto).toBe(5n);

    // Typed the moment the link is back: the answer to the re-pull (a snapshot newer than
    // Alice's replica) arrives while this edit is still unacknowledged.
    kernel.setLink(ALICE, 'up');
    await typeInto(alice.replica(), 'A');
    await kernel.settle([alice.session, bob.session]);
    expect(alice.replicas).toHaveLength(2);
    expect(await converged([alice, bob])).toBe(true);
    const text: string = await snapshotText(alice.replica());
    expect(text).toContain('A');
    expect(text).toContain('bbbb');
  });
});

describe('what the session reports', () => {
  it('surfaces a refused Append and stops writing', async () => {
    const { kernel, clock } = await newDocument({ maxUpdateBytes: 8 });
    const alice: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
    await alice.session.open();
    await kernel.settle([alice.session]);
    await typeInto(alice.replica(), 'a');
    await kernel.settle([alice.session]);
    await typeInto(alice.replica(), 'b');
    await kernel.settle([alice.session]);

    expect(alice.problems.map((p) => p.problem.kind)).toEqual(['refused']);
    const problem: (typeof alice.problems)[number]['problem'] = alice.problems[0].problem;
    expect(problem.kind === 'refused' && typeof problem.refusal !== 'string' && 'UpdateTooLarge' in problem.refusal).toBe(true);
    expect(kernel.sentOf('Append')).toHaveLength(1);
  });

  it('refuses locally an update over the limit it shares with the server, and never sends it', async () => {
    const { kernel, clock } = await newDocument({});
    const alice: RealTab = openTab(kernel, clock, ALICE, { limits: { ...DOCUMENTS_RELAY_LIMITS, maxUpdateBytes: 8 } }, realReplicas(), null);
    await alice.session.open();
    await kernel.settle([alice.session]);
    await typeInto(alice.replica(), 'a');
    await kernel.settle([alice.session]);
    expect(alice.problems.map((p) => p.problem)).toEqual([expect.objectContaining({ kind: 'tooLarge', what: 'update', maxBytes: 8 })]);
    expect(kernel.sentOf('Append')).toHaveLength(0);
  });

  it('surfaces a denied write permission', async () => {
    const { kernel, clock } = await newDocument({});
    kernel.deny(BOB, 'EditMdx');
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await bob.session.open();
    await kernel.settle([bob.session]);
    await typeInto(bob.replica(), 'x');
    await kernel.settle([bob.session]);
    expect(bob.problems.map((p) => p.problem)).toEqual([{ kind: 'permissionDenied', message: 'Permission denied: EditMdx required' }]);
  });

  it('names a doc_version mismatch and does not apply the update', async () => {
    const { kernel, clock } = await newDocument({});
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await bob.session.open();
    await kernel.settle([bob.session]);
    kernel.inject(BOB, { DocumentUpdated: { node_id: NODE, seq: 2n, doc_version: CDOC_CRDT_DOC_VERSION + 1, update: [1, 2, 3], author_cid: ALICE } });
    await kernel.settle([bob.session]);

    expect(bob.problems).toHaveLength(1);
    expect(bob.problems[0].name).toBe('DocVersionMismatchError');
    expect(bob.problems[0].problem).toEqual({ kind: 'docVersionMismatch', expected: CDOC_CRDT_DOC_VERSION, received: CDOC_CRDT_DOC_VERSION + 1, where: 'update 2' });
    expect(bob.session.seq).toBe(1n);
  });

  it('ignores traffic for another node', async () => {
    const { kernel, clock } = await newDocument({});
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await bob.session.open();
    await kernel.settle([bob.session]);
    kernel.inject(BOB, { Refused: { NoSuchNode: { node_id: 'another-node' } } });
    await kernel.settle([bob.session]);
    expect(bob.problems).toEqual([]);
  });
});
