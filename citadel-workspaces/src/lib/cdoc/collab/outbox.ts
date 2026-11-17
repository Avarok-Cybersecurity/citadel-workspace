/**
 * Local updates the server has not yet acknowledged, in the order the editor made them. Pure.
 *
 * Each takes the next `client_seq`, which `Appended` echoes: the protocol has no request id,
 * so that echo is how an answer is matched to its update. Entries stay until answered, so a
 * reconnect sends them again in order. A resend the server had already stored appends the same
 * bytes twice, which a CRDT merges as a no-op.
 */
export interface PendingUpdate {
  readonly clientSeq: bigint;
  readonly update: Uint8Array;
}

export class Outbox {
  private next: bigint;
  private readonly pending: PendingUpdate[] = [];

  constructor(clientSeqBase: bigint) {
    this.next = clientSeqBase;
  }

  push(update: Uint8Array): PendingUpdate {
    const entry: PendingUpdate = { clientSeq: this.next, update };
    this.next += 1n;
    this.pending.push(entry);
    return entry;
  }

  /** Removes and returns the update the server answered for, or null when it is not ours. */
  settle(clientSeq: bigint): PendingUpdate | null {
    const index: number = this.pending.findIndex((entry: PendingUpdate): boolean => entry.clientSeq === clientSeq);
    if (index < 0) return null;
    return this.pending.splice(index, 1)[0];
  }

  has(clientSeq: bigint): boolean {
    return this.pending.some((entry: PendingUpdate): boolean => entry.clientSeq === clientSeq);
  }

  all(): readonly PendingUpdate[] {
    return [...this.pending];
  }

  get empty(): boolean {
    return this.pending.length === 0;
  }
}
