/**
 * The keeper DocsCanvas calls: it shows the replica the session opened over the log (and its
 * re-opens), forwards every problem, and tears the session and the replica down together.
 * The real editor over the scripted kernel (doubles/scripted-kernel.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import type { EditorOpener } from '../../editor/controller';
import type { EditorSession } from '../../editor/editor-session';
import type { DocumentSessionPorts } from '../ports';
import { R1_COLLABORATION, replicaKeeper, type Keeper } from '../replica-keeper';
import type { DocumentSessionError } from '../session-errors';
import { ALICE, NODE, newDocument, pacingFor } from './doubles/harness';
import { realReplicas, snapshotText, typeInto, type ReplicaSource } from './doubles/real-replicas';

describe('the replica keeper', () => {
  it('shows the replica opened over the log, forwards problems, and tears both down', async () => {
    const { kernel, clock } = await newDocument({ maxUpdateBytes: 8 });
    const replicas: ReplicaSource<EditorSession> = realReplicas();
    const ports = (open: EditorOpener): DocumentSessionPorts => ({ transport: kernel.connect(ALICE), clock, cache: null, openEditor: open, identify: () => ({ name: 'Alice', color: '#4F46E5' }), pacing: pacingFor(kernel, clock) });
    const problems: DocumentSessionError[] = [];
    const bound: string[] = [];
    const bind = (): (() => void) => { bound.push('bound'); return (): void => { bound.push('unbound'); }; };
    const keep: Keeper<EditorSession> = replicaKeeper<EditorSession>({ ...R1_COLLABORATION, nodeId: NODE, clientSeqBase: 1n << 32n }, ports, (p: DocumentSessionError): void => { problems.push(p); }, bind);
    const shown: EditorSession[] = [];
    const failures: unknown[] = [];
    const stop: () => void = keep(replicas.open, (e: EditorSession): void => { shown.push(e); }, (e: unknown): void => { failures.push(e); });

    // The keeper hides its session, so this waits on what it shows; the kernel delivers as it goes.
    const settle = (): Promise<void> => kernel.settle([{ settled: (): Promise<void> => Promise.resolve() }]);
    await vi.waitFor(async (): Promise<void> => { await settle(); expect(shown).toHaveLength(1); });
    expect(shown).toEqual([replicas.opened[0]]);
    expect('snapshot' in replicas.sources[0]).toBe(true);
    expect(await snapshotText(shown[0])).not.toBe('');

    await typeInto(shown[0], 'x');
    await vi.waitFor(async (): Promise<void> => { await settle(); expect(problems).toHaveLength(1); });
    expect(problems.map((p: DocumentSessionError) => p.problem.kind)).toEqual(['refused']);
    expect(failures).toEqual([]);

    expect(bound).toEqual(['bound']);
    stop();
    expect(bound).toEqual(['bound', 'unbound']);
    await expect(shown[0].snapshot()).rejects.toThrow();
  });

  it('is configured explicitly for R1: no gc, snapshots on the server\'s hint only', () => {
    expect(R1_COLLABORATION.gcBeforeSnapshot).toBe('never');
    expect(R1_COLLABORATION.snapshotAfterLocalUpdates).toBeNull();
    expect(R1_COLLABORATION.peerExpiryMs).toBeGreaterThanOrEqual(R1_COLLABORATION.awarenessHeartbeatMs * 3);
  });
});
