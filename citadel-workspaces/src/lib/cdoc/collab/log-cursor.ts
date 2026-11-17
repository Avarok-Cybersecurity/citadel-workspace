/**
 * Where this replica stands in a node's update log. Pure.
 *
 * `seq` is the contiguous prefix the replica holds: every update numbered `1..=seq` is in it.
 * The server's seqs start at 1 and never repeat, and its broadcast drops a lagging receiver's
 * messages (channel depth 100), so anything that does not follow `seq` exactly is a gap, which
 * the session closes by pulling from `seq`.
 *
 * Our own updates are in the replica before the server numbers them. An `Appended` for one
 * that does not follow `seq` is held here, so the pull that closes the gap does not apply it
 * again and the cursor steps over it once the gap is filled.
 */
export type Placement = 'next' | 'old' | 'gap';

export class LogCursor {
  private applied: bigint;
  private readonly ownAhead: Set<bigint> = new Set<bigint>();

  constructor(start: bigint) {
    this.applied = start;
  }

  get seq(): bigint {
    return this.applied;
  }

  /** Whether an update numbered `seq` is the next one, one already held, or past a gap. */
  place(seq: bigint): Placement {
    if (seq <= this.applied || this.ownAhead.has(seq)) return 'old';
    return seq === this.applied + 1n ? 'next' : 'gap';
  }

  /** The update numbered `seq`, which `place` called next, is now in the replica. */
  advance(seq: bigint): void {
    if (seq !== this.applied + 1n) throw new Error(`log cursor at ${this.applied} cannot advance to ${seq}`);
    this.applied = seq;
    while (this.ownAhead.delete(this.applied + 1n)) this.applied += 1n;
  }

  /** The server numbered one of our own updates `seq`; false when that leaves a gap before it. */
  own(seq: bigint): boolean {
    const placement: Placement = this.place(seq);
    if (placement === 'next') this.advance(seq);
    else if (placement === 'gap') this.ownAhead.add(seq);
    return placement !== 'gap';
  }

  /** A snapshot covering `1..=seq` replaced the replica's state. */
  rebase(seq: bigint): void {
    this.applied = seq;
    for (const held of this.ownAhead) if (held <= seq) this.ownAhead.delete(held);
    while (this.ownAhead.delete(this.applied + 1n)) this.applied += 1n;
  }

  /** No own update is held past a gap: the replica is exactly the log's `1..=seq`. */
  get contiguous(): boolean {
    return this.ownAhead.size === 0;
  }
}
