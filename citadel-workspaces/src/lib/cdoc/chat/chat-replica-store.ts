/**
 * The open replica's copy on this device: the updates applied since its stored snapshot,
 * written after the replica has been still for `storeAfterIdleMs`, and folded into a new
 * snapshot once there are `foldAfterUpdates` of them (or on the first write, when nothing is
 * stored yet). A reopen is the stored snapshot plus those updates, in order.
 *
 * The copy is shared: the member's other windows keep the same document in the same agent
 * LocalDB, and a closed window's inbox records the peer's edits into it. So every write takes
 * the copy's browser-wide turn (ChatStoreBackend.exclusive), first brings what is stored into
 * the replica (another window's snapshot, then each update it lacks), and only then writes, so
 * the snapshot and the list it writes hold everything that was stored. Hearing another
 * writer's write brings it in the same way, without writing.
 *
 * The fold is cut where snapshot() was called: everything recorded before then is in the
 * snapshot (a local edit is recorded after its command ran, a peer's after it was applied), so
 * those are dropped, and anything recorded during the call stays. A crash between the two
 * writes leaves updates the snapshot already holds, which the CRDT absorbs on reopen.
 */
import type { Clock } from '../collab/ports';
import type { ChatSyncConfig } from './chat-config';
import type { ChatStoreBackend, StoredBase } from './chat-ports';
import { ChatSyncError, type ChatSyncProblem } from './chat-problems';

export interface ReplicaStoreHost {
  snapshot(): Promise<Uint8Array>;
  /** Brings a snapshot another writer stored into the replica (what it holds that the replica lacks). */
  absorbSnapshot(snapshot: Uint8Array): Promise<void>;
  /** Applies an update another writer stored. */
  absorbUpdate(update: Uint8Array): Promise<void>;
  report(problem: ChatSyncProblem): void;
}

/** What the replica was opened over. */
export interface OpenedCopy {
  readonly base: Uint8Array | null;
  readonly pending: readonly Uint8Array[];
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte: number, i: number): boolean => byte === b[i]);

export class ChatReplicaStore {
  private readonly pending: Uint8Array[];
  /** The stored snapshot the replica holds everything of (opened over, absorbed or written); null before the first write. */
  private base: Uint8Array | null;
  private dirty: boolean;
  private cancelIdle: (() => void) | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly backend: ChatStoreBackend,
    private readonly docId: string,
    private readonly config: Pick<ChatSyncConfig, 'docVersion' | 'storeAfterIdleMs' | 'foldAfterUpdates'>,
    private readonly clock: Clock,
    opened: OpenedCopy,
    private readonly host: ReplicaStoreHost,
  ) {
    this.pending = [...opened.pending];
    this.base = opened.base;
    // A document new to this device is written at the first pause, edited or not.
    this.dirty = opened.base === null;
    if (this.dirty) this.arm();
  }

  /** An update this replica made or applied. */
  added(update: Uint8Array): void {
    this.pending.push(update.slice());
    this.dirty = true;
    this.arm();
  }

  /** Writes what has changed now; resolves once it is written (a failure is reported, and kept for the next write). */
  write(): Promise<void> {
    if (this.cancelIdle !== null) this.cancelIdle();
    this.cancelIdle = null;
    return this.queue((): Promise<void> => this.writeNow());
  }

  /** Another writer wrote the copy: what it stored comes into the replica. */
  heard(): Promise<void> {
    return this.queue(async (): Promise<void> => {
      try {
        await this.backend.exclusive(this.docId, (): Promise<void> => this.absorb());
      } catch (cause: unknown) {
        this.failed('read', cause);
      }
    });
  }

  private queue(step: () => Promise<void>): Promise<void> {
    const next: Promise<void> = this.tail.then(step);
    this.tail = next;
    return next;
  }

  private arm(): void {
    if (this.cancelIdle !== null) this.cancelIdle();
    this.cancelIdle = this.clock.after(this.config.storeAfterIdleMs, (): void => {
      this.cancelIdle = null;
      void this.write();
    });
  }

  /** Brings what is stored into the replica: a snapshot it does not hold yet, then each update it lacks. */
  private async absorb(): Promise<void> {
    const [stored, pending]: [StoredBase | null, readonly Uint8Array[]] = await Promise.all([this.backend.loadBase(this.docId), this.backend.loadPending(this.docId)]);
    if (stored !== null && (this.base === null || !sameBytes(stored.snapshot, this.base))) {
      if (stored.docVersion !== this.config.docVersion) {
        throw new ChatSyncError({ kind: 'docVersionMismatch', expected: this.config.docVersion, received: stored.docVersion, where: 'the stored copy' });
      }
      await this.host.absorbSnapshot(stored.snapshot);
      this.base = stored.snapshot;
    }
    for (const update of pending) {
      if (this.pending.some((held: Uint8Array): boolean => sameBytes(held, update))) continue;
      await this.host.absorbUpdate(update);
      this.pending.push(update);
    }
  }

  private async writeNow(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.backend.exclusive(this.docId, async (): Promise<void> => {
        await this.absorb();
        if (this.base === null || this.pending.length >= this.config.foldAfterUpdates) {
          const cut: number = this.pending.length;
          const snapshot: Uint8Array = await this.host.snapshot();
          await this.backend.saveBase(this.docId, { docVersion: this.config.docVersion, snapshot });
          this.base = snapshot;
          this.pending.splice(0, cut);
        }
        await this.backend.savePending(this.docId, this.pending.slice());
      });
    } catch (cause: unknown) {
      // Kept for the next write.
      this.dirty = true;
      this.failed('write', cause);
      return;
    }
    this.backend.wrote(this.docId, this);
  }

  /** Reports a failed read or write: as itself when it is a ChatSyncError (a copy in another format). */
  private failed(operation: 'read' | 'write', cause: unknown): void {
    this.host.report(cause instanceof ChatSyncError ? cause.problem : { kind: 'storeFailed', operation, cause });
  }
}
