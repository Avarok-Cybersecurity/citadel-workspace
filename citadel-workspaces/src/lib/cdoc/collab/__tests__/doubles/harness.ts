/**
 * A kernel double and tabs on it, each tab a production DocumentSession over its own replica.
 */
import type { HexColor } from '../../../editor/model-values';
import type { PeerPresence } from '../../../editor/peer-overlay';
import { DocumentSession } from '../../document-session';
import type { EditorController, EditorOrigin } from '../../../editor/controller';
import type { DocumentSessionConfig, DocumentCache } from '../../ports';
import { CDOC_CRDT_DOC_VERSION, DOCUMENTS_RELAY_LIMITS } from '../../relay-limits';
import type { DocumentSessionError } from '../../session-errors';
import { ManualClock } from './manual-clock';
import { baseSnapshot, type ReplicaSource } from './real-replicas';
import { ScriptedKernel, type ScriptedKernelConfig } from './scripted-kernel';
import { RequestPacer, type DocumentPacing } from '../../request-pacer';

export const NODE: string = 'doc-node-1';
export const ALICE: bigint = 10_000_000_000_000_000_001n;
export const BOB: bigint = 10_000_000_000_000_000_002n;

/** The kernel.toml values (docker/workspace-server/kernel.toml); tests override what they probe. */
export function kernelConfig(overrides: Partial<ScriptedKernelConfig>): ScriptedKernelConfig {
  return {
    maxUpdatesPerPull: 64,
    snapshotMinUpdates: 256n,
    maxUpdateBytes: DOCUMENTS_RELAY_LIMITS.maxUpdateBytes,
    maxSnapshotBytes: DOCUMENTS_RELAY_LIMITS.maxSnapshotBytes,
    maxAwarenessBytes: DOCUMENTS_RELAY_LIMITS.maxAwarenessBytes,
    awarenessPerSecond: DOCUMENTS_RELAY_LIMITS.awarenessPerSecond,
    appendsPerSecond: DOCUMENTS_RELAY_LIMITS.appendsPerSecond,
    pullsPerSecond: DOCUMENTS_RELAY_LIMITS.pullsPerSecond,
    ...overrides,
  };
}

/**
 * Test values, each chosen so a test can reach it: no snapshot unless the test asks, a pull
 * timeout and heartbeat long enough not to fire unless the clock is moved past them.
 */
export function sessionConfig(clientSeqBase: bigint, overrides: Partial<DocumentSessionConfig>): DocumentSessionConfig {
  return {
    nodeId: NODE,
    docVersion: CDOC_CRDT_DOC_VERSION,
    limits: DOCUMENTS_RELAY_LIMITS,
    snapshotAfterLocalUpdates: null,
    gcBeforeSnapshot: 'never',
    pullTimeoutMs: 5_000,
    retryDelaysMs: [1_000, 3_000, 6_000],
    awarenessHeartbeatMs: 3_000,
    peerExpiryMs: 10_000,
    // Room for the two-tabs-of-one-account tests; the cap itself is peer-book.test.ts's.
    maxCaretsPerSession: 4,
    clientSeqBase,
    // The app's (R1_COLLABORATION): tests of AutoSave off say so.
    autoSaveWhenUnset: true,
    // The app's; tests reach it by moving the clock.
    baseAfterIdleMs: 2_000,
    ...overrides,
  };
}

export interface Tab<R extends EditorController> {
  readonly session: DocumentSession;
  readonly replicas: R[];
  /** What each replica was opened from, in order. */
  readonly sources: EditorOrigin[];
  readonly problems: DocumentSessionError[];
  readonly peers: (readonly PeerPresence[])[];
  /** The replica on screen: the latest one opened. */
  replica(): R;
}

const COLORS: Record<string, HexColor> = { [ALICE.toString()]: '#4F46E5', [BOB.toString()]: '#10B981' };

let tabs: number = 0;

/** A tab of session `cid`, its replicas from `replicas` (realReplicas(), or the stand-in). */
export function openTab<R extends EditorController>(kernel: ScriptedKernel, clock: ManualClock, cid: bigint, config: Partial<DocumentSessionConfig>, replicas: ReplicaSource<R>, cache: DocumentCache | null): Tab<R> {
  tabs += 1;
  const session: DocumentSession = new DocumentSession(sessionConfig(BigInt(tabs) << 32n, config), {
    transport: kernel.connect(cid),
    clock,
    cache,
    openEditor: replicas.open,
    identify: (who: bigint): { readonly name: string; readonly color: HexColor } => ({ name: who === ALICE ? 'Alice' : 'Bob', color: COLORS[who.toString()] }),
    pacing: pacingFor(kernel, clock),
  });
  const tab: Tab<R> = {
    session,
    replicas: replicas.opened,
    sources: replicas.sources,
    problems: [],
    peers: [],
    replica: (): R => {
      const latest: R | undefined = replicas.opened[replicas.opened.length - 1];
      if (!latest) throw new Error('no replica opened yet');
      return latest;
    },
  };
  session.on('problem', (problem: DocumentSessionError): void => { tab.problems.push(problem); });
  session.on('peers', (peers: readonly PeerPresence[]): void => { tab.peers.push(peers); });
  return tab;
}

/** One tab's pacers, as workspace-ports.ts makes them, which the kernel's settle() waits out. */
export function pacingFor(kernel: ScriptedKernel, clock: ManualClock): DocumentPacing {
  const pacing: DocumentPacing = { appends: new RequestPacer(clock, DOCUMENTS_RELAY_LIMITS.appendsPerSecond), pulls: new RequestPacer(clock, DOCUMENTS_RELAY_LIMITS.pullsPerSecond) };
  kernel.paced(pacing.appends, pacing.pulls);
  return pacing;
}

export function newKernel(overrides: Partial<ScriptedKernelConfig>): { readonly kernel: ScriptedKernel; readonly clock: ManualClock } {
  const clock: ManualClock = new ManualClock();
  return { kernel: new ScriptedKernel(NODE, kernelConfig(overrides), clock), clock };
}

/**
 * A kernel whose node already holds one shared base (see real-replicas.ts): seq 1, compacted
 * into the snapshot. Every real replica opens on it, so every log seq here is one higher than
 * the edits a test makes.
 */
export async function newDocument(overrides: Partial<ScriptedKernelConfig>): Promise<{ readonly kernel: ScriptedKernel; readonly clock: ManualClock }> {
  const made: { readonly kernel: ScriptedKernel; readonly clock: ManualClock } = newKernel(overrides);
  made.kernel.log.seedBase(Array.from(await baseSnapshot()), CDOC_CRDT_DOC_VERSION);
  return made;
}

/** Whether every tab's replica holds exactly the same document (cdoc-crdt snapshots are canonical). */
export async function converged(tabs: readonly Tab<EditorController>[]): Promise<boolean> {
  const snapshots: string[] = await Promise.all(tabs.map(async (t: Tab<EditorController>): Promise<string> => Array.from(await t.replica().snapshot()).join(',')));
  return snapshots.every((s: string): boolean => s === snapshots[0]);
}
