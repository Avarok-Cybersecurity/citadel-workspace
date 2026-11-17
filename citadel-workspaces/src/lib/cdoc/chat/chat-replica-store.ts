/**
 * The open replica's copy on this device: the updates applied since its stored snapshot,
 * written after the replica has been still for `storeAfterIdleMs`, and folded into a new
 * snapshot once there are `foldAfterUpdates` of them (or on the first write, when nothing is
 * stored yet). A reopen is the stored snapshot plus those updates, in order.
 *
 * The fold is cut where snapshot() was called: everything recorded before then is in the
 * snapshot (a local edit is recorded after its command ran, a peer's after it was applied), so
 * those are dropped, and anything recorded during the call stays. A crash between the two
 * writes leaves updates the snapshot already holds, which the CRDT absorbs on reopen.
 */
import type { Clock } from '../collab/ports';
import type { ChatSyncConfig } from './chat-config';
import type { ChatStoreBackend } from './chat-ports';
import type { ChatSyncProblem } from './chat-problems';

export interface ReplicaStoreHost {
  snapshot(): Promise<Uint8Array>;
  report(problem: ChatSyncProblem): void;
}

/** What the replica was opened over. */
export interface OpenedCopy {
  readonly baseStored: boolean;
  readonly pending: readonly Uint8Array[];
  readonly migrationOrigin: string | null;
}

export class ChatReplicaStore {
  private readonly pending: Uint8Array[];
  private baseStored: boolean;
  private dirty: boolean;
  private cancelIdle: (() => void) | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly backend: ChatStoreBackend,
    private readonly docId: string,
    private readonly config: Pick<ChatSyncConfig, 'docVersion' | 'storeAfterIdleMs' | 'foldAfterUpdates'>,
    private readonly clock: Clock,
    private readonly opened: OpenedCopy,
    private readonly host: ReplicaStoreHost,
  ) {
    this.pending = [...opened.pending];
    this.baseStored = opened.baseStored;
    // A document new to this device is written at the first pause, edited or not.
    this.dirty = !opened.baseStored;
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
    const step: Promise<void> = this.tail.then((): Promise<void> => this.writeNow());
    this.tail = step;
    return step;
  }

  private arm(): void {
    if (this.cancelIdle !== null) this.cancelIdle();
    this.cancelIdle = this.clock.after(this.config.storeAfterIdleMs, (): void => {
      this.cancelIdle = null;
      void this.write();
    });
  }

  private async writeNow(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (!this.baseStored || this.pending.length >= this.config.foldAfterUpdates) {
        const cut: number = this.pending.length;
        const snapshot: Uint8Array = await this.host.snapshot();
        await this.backend.saveBase(this.docId, { docVersion: this.config.docVersion, snapshot, migrationOrigin: this.opened.migrationOrigin });
        this.baseStored = true;
        this.pending.splice(0, cut);
      }
      await this.backend.savePending(this.docId, this.pending.slice());
    } catch (cause: unknown) {
      this.dirty = true;
      this.host.report({ kind: 'storeFailed', operation: 'write', cause });
    }
  }
}
