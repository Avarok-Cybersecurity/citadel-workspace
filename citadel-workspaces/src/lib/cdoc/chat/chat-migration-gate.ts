/**
 * Two copies of a chat document moved to Citadel Docs from different originals are never
 * merged: each migration is written by its own client id, so a merge would hold the document
 * twice. A hello names what the sender's copy was moved from (`migration_origin`), and a copy
 * answers a hello with its diff only after reading it, so when the two origins differ the
 * copies are held apart before either has sent its content: from then on nothing but a hello
 * is exchanged, so the peer learns it too. A peer's update cannot carry the other copy's
 * content: it builds on that copy's migration, which this replica does not hold. Which of the
 * two is the document (its creator's) is the chat's to say (live-doc-migration/conflict-rule.ts);
 * the wire carries no snapshot to adopt.
 */
export class MigrationGate {
  constructor(private readonly ours: string | null, private apartNow: boolean) {}

  get apart(): boolean {
    return this.apartNow;
  }

  /** The peer's hello: true when this is the hello that held the copies apart (both new counts as the same origin). */
  holdsApart(theirs: string | null): boolean {
    if (this.apartNow || theirs === this.ours) return false;
    this.apartNow = true;
    return true;
  }
}
