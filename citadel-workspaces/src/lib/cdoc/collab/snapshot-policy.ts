/**
 * When a replica stores the snapshot that compacts its node's log: when the server's
 * `Appended.compaction` asks, or after the configured number of local updates (none when that
 * is null). Never on a timer.
 *
 * A snapshot claims to hold every update up to `upto_seq`, so it is taken only when the replica
 * is exactly the log's prefix: nothing of ours unacknowledged, nothing held past a gap, no pull
 * outstanding. Once the server has stored it, it is also this replica's local cache.
 *
 * Tombstone GC (cdoc-crdt `Doc::gc`, explicit since format v2) is what keeps a snapshot small
 * (a 100k-edit churn: 1.54 MB uncollected, 7.3 KB collected), and it is valid only when every
 * peer holds everything this replica holds, or a peer's later edit can name a collected item.
 * So it runs only here, immediately before StoreSnapshot, by the snapshotting client, and only
 * when `gcBeforeSnapshot` is 'whenAlone', the replica is exactly the log's prefix (all our
 * Appends acknowledged, no gap) and the awareness relay shows no other live peer. Otherwise the
 * snapshot is stored uncollected. "No live peer" cannot see a peer that is offline with
 * unsent edits; whether that risk is acceptable is the owner's call (with retention).
 */
import type { DocumentsRequest } from 'citadel-workspace-client-ts';
import type { EditorController } from '../editor/controller';
import type { DocumentSessionConfig, DocumentSessionPorts } from './ports';
import type { DocumentSessionProblem } from './session-errors';
import { toWire } from './wire-bytes';

export type Send = (request: DocumentsRequest, name: string) => Promise<void>;

export interface SnapshotHost {
  report(problem: DocumentSessionProblem): void;
  linkUp(): boolean;
  writable(): boolean;
  /** No other peer is present in the document (the awareness relay has heard none lately). */
  alone(): boolean;
}

export class SnapshotPolicy {
  private localSince: number = 0;
  private due: boolean = false;
  private sent: { readonly bytes: Uint8Array; readonly upto: bigint } | null = null;

  constructor(
    private readonly config: DocumentSessionConfig,
    private readonly ports: DocumentSessionPorts,
    private readonly host: SnapshotHost,
    private readonly send: Send,
  ) {}

  get inFlight(): boolean {
    return this.sent !== null;
  }

  countLocal(): void {
    this.localSince += 1;
    const every: number | null = this.config.snapshotAfterLocalUpdates;
    if (every !== null && this.localSince >= every) this.due = true;
  }

  /** The server's compaction hint. */
  requested(): void {
    this.due = true;
  }

  /** The stored or refused answer will not come (link lost, or refused): it may be tried again. */
  abandon(): void {
    this.sent = null;
  }

  /** Stores the snapshot if one is due and the replica is exactly the log's `1..=seq`. */
  async consider(editor: EditorController | null, seq: bigint, exact: boolean): Promise<void> {
    if (!this.due || this.sent || !exact || !editor || seq === 0n || !this.host.writable() || !this.host.linkUp()) return;
    let bytes: Uint8Array;
    try {
      // Exactly the log's prefix: the log, which every later replica opens from, holds what this
      // one holds, so this replica's own state vector is what is acknowledged.
      if (this.config.gcBeforeSnapshot === 'whenAlone' && this.host.alone()) await editor.collectGarbage([await editor.stateVector()]);
      bytes = await editor.snapshot();
    } catch (cause: unknown) {
      this.host.report({ kind: 'editorFailed', operation: 'take a snapshot', cause });
      return;
    }
    this.due = false;
    this.localSince = 0;
    const max: number = this.config.limits.maxSnapshotBytes;
    if (bytes.byteLength > max) {
      this.host.report({ kind: 'tooLarge', what: 'snapshot', sizeBytes: bytes.byteLength, maxBytes: max });
      return;
    }
    this.sent = { bytes, upto: seq };
    await this.send({ StoreSnapshot: { node_id: this.config.nodeId, doc_version: this.config.docVersion, snapshot: toWire(bytes), upto_seq: seq } }, 'StoreSnapshot');
  }

  async stored(upto: bigint): Promise<void> {
    const sent: { readonly bytes: Uint8Array; readonly upto: bigint } | null = this.sent;
    if (!sent || sent.upto !== upto) return;
    this.sent = null;
    if (!this.ports.cache) return;
    try {
      await this.ports.cache.save(this.config.nodeId, { docVersion: this.config.docVersion, snapshot: sent.bytes, seq: upto });
    } catch (cause: unknown) {
      this.host.report({ kind: 'cacheFailed', operation: 'write', cause });
    }
  }
}
