/**
 * One node's update log, numbered, paged and compacted exactly as the kernel's
 * `kernel/documents/log.rs` (`plan_pull`, `plan_snapshot`, `compaction_due`) and
 * `command_processor/documents/{reads,writes}.rs` do it. Every answer is a generated
 * `DocumentsResponse`, so a shape the session reads that the server does not send is a type
 * error here.
 */
import type { DocumentRefusal, DocumentSnapshot, DocumentUpdate, DocumentsResponse } from 'citadel-workspace-client-ts';

/** The `[documents]` table's keys the log reads (kernel.toml). */
export interface KernelLogConfig {
  readonly maxUpdatesPerPull: number;
  readonly snapshotMinUpdates: bigint;
  readonly maxUpdateBytes: number;
  readonly maxSnapshotBytes: number;
}

export class KernelLog {
  latestSeq: bigint = 0n;
  snapshotUpto: bigint = 0n;
  private snapshot: DocumentSnapshot | null = null;
  private readonly updates: Map<bigint, DocumentUpdate> = new Map<bigint, DocumentUpdate>();

  constructor(private readonly nodeId: string, private readonly config: KernelLogConfig) {}

  append(update: readonly number[], docVersion: number, authorCid: bigint, clientSeq: bigint): { answer: DocumentsResponse; stored: DocumentUpdate | null } {
    if (update.length > this.config.maxUpdateBytes) {
      return { answer: this.refused({ UpdateTooLarge: { node_id: this.nodeId, size_bytes: BigInt(update.length), max_bytes: BigInt(this.config.maxUpdateBytes) } }), stored: null };
    }
    this.latestSeq += 1n;
    const stored: DocumentUpdate = { seq: this.latestSeq, doc_version: docVersion, update: [...update], author_cid: authorCid };
    this.updates.set(stored.seq, stored);
    const pending: bigint = this.latestSeq - this.snapshotUpto;
    return {
      stored,
      answer: { Appended: { node_id: this.nodeId, seq: stored.seq, client_seq: clientSeq, compaction: pending >= this.config.snapshotMinUpdates ? { node_id: this.nodeId, pending } : null } },
    };
  }

  pull(sinceSeq: bigint): DocumentsResponse {
    const withSnapshot: boolean = sinceSeq < this.snapshotUpto;
    const first: bigint = (sinceSeq > this.snapshotUpto ? sinceSeq : this.snapshotUpto) + 1n;
    const cap: bigint = first + BigInt(this.config.maxUpdatesPerPull) - 1n;
    const last: bigint = this.latestSeq < cap ? this.latestSeq : cap;
    const updates: DocumentUpdate[] = [];
    for (let seq: bigint = first; seq <= last; seq += 1n) {
      const update: DocumentUpdate | undefined = this.updates.get(seq);
      if (update) updates.push(update);
    }
    return { Updates: { node_id: this.nodeId, snapshot: withSnapshot ? this.snapshot : null, updates, has_more: last < this.latestSeq, latest_seq: this.latestSeq } };
  }

  storeSnapshot(bytes: readonly number[], docVersion: number, uptoSeq: bigint): DocumentsResponse {
    if (bytes.length > this.config.maxSnapshotBytes) {
      return this.refused({ SnapshotTooLarge: { node_id: this.nodeId, size_bytes: BigInt(bytes.length), max_bytes: BigInt(this.config.maxSnapshotBytes) } });
    }
    if (uptoSeq > this.latestSeq) return this.refused({ SnapshotAhead: { node_id: this.nodeId, upto_seq: uptoSeq, latest_seq: this.latestSeq } });
    if (uptoSeq <= this.snapshotUpto) return this.refused({ SnapshotBehind: { node_id: this.nodeId, upto_seq: uptoSeq, stored_upto_seq: this.snapshotUpto } });
    this.snapshot = { doc_version: docVersion, bytes: [...bytes], upto_seq: uptoSeq };
    this.snapshotUpto = uptoSeq;
    for (const seq of [...this.updates.keys()]) if (seq <= uptoSeq) this.updates.delete(seq);
    return { SnapshotStored: { node_id: this.nodeId, upto_seq: uptoSeq } };
  }

  /**
   * A document whose first update has been compacted into a snapshot: the state a log reaches
   * after `append` then `storeSnapshot(…, 1n)`, written in one step so every replica opens on
   * one shared base (independent blank replicas share none; see real-replicas.ts).
   */
  seedBase(bytes: readonly number[], docVersion: number): void {
    this.latestSeq = 1n;
    this.snapshotUpto = 1n;
    this.snapshot = { doc_version: docVersion, bytes: [...bytes], upto_seq: 1n };
  }

  /** How many updates the log still holds (after compaction). */
  get held(): number {
    return this.updates.size;
  }

  private refused(refusal: DocumentRefusal): DocumentsResponse {
    return { Refused: refusal };
  }
}
