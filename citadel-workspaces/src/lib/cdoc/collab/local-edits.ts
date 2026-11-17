/**
 * This tab's edits the server has not acknowledged: the outbox, a copy of it kept on this
 * device (so closing or reloading loses none), and which of them may be sent.
 *
 * With AutoSave on, every edit may go as it is made. With it off they stay here until a sync is
 * requested (Save, AutoSave turned on, a share), which lets go exactly the edits made before it;
 * later ones wait for the next. A tab that closed with edits still held leaves them for the next
 * tab to open the document, which applies them, sends them as its own, and removes theirs.
 *
 * Writes to the device are coalesced: one in flight, and one more if edits changed meanwhile,
 * always of the whole outbox, so the stored list is never behind by more than the last step.
 */
import { Outbox, type PendingUpdate } from './outbox';
import type { DocumentCache, DocumentSessionConfig, HeldEdits } from './ports';
import type { LocalWrite, SaveInputs } from '@/lib/document-save/save-status';
import type { DocumentSessionProblem } from './session-errors';

export interface LocalEditsHost {
  report(problem: DocumentSessionProblem): void;
  /** Something SaveInputs reads has changed. */
  changed(): void;
}

export class LocalEdits {
  private readonly outbox: Outbox;
  private readonly nodeId: string;
  private readonly instance: string;
  private autoSaveNow: boolean;
  private syncThrough: bigint | null = null;
  private local: LocalWrite;
  private dirty: boolean = false;
  private writing: Promise<void> | null = null;
  private release: (() => void) | null = null;
  private closed: boolean = false;

  constructor(config: DocumentSessionConfig, private readonly cache: DocumentCache | null, private readonly host: LocalEditsHost) {
    this.outbox = new Outbox(config.clientSeqBase);
    this.nodeId = config.nodeId;
    this.instance = config.clientSeqBase.toString();
    this.autoSaveNow = config.autoSaveWhenUnset;
    // With nowhere to keep them, edits not yet acknowledged are only in this tab.
    this.local = cache ? 'written' : 'unavailable';
  }

  get autoSave(): boolean {
    return this.autoSaveNow;
  }

  get empty(): boolean {
    return this.outbox.empty;
  }

  all(): readonly PendingUpdate[] {
    return this.outbox.all();
  }

  /** Not yet acknowledged. */
  pending(entry: PendingUpdate): boolean {
    return this.outbox.has(entry.clientSeq);
  }

  inputs(): Omit<SaveInputs, 'link' | 'halted' | 'locked'> {
    return { autoSave: this.autoSaveNow, unacknowledged: this.outbox.all().length, syncRequested: this.syncThrough !== null, local: this.local };
  }

  /** Marks this instance open, reads this device's AutoSave choice, and returns closed tabs' edits. */
  async open(): Promise<readonly HeldEdits[]> {
    const cache: DocumentCache | null = this.cache;
    if (!cache) return [];
    try {
      const release: () => void = await cache.hold(this.nodeId, this.instance);
      if (this.closed) release();
      else this.release = release;
      const choices: { readonly autoSave: boolean } | null = await cache.loadChoices(this.nodeId);
      if (choices) this.autoSaveNow = choices.autoSave;
      this.host.changed();
      return (await cache.loadEdits(this.nodeId)).filter((held: HeldEdits): boolean => !held.open && held.instance !== this.instance);
    } catch (cause: unknown) {
      this.host.report({ kind: 'cacheFailed', operation: 'read', cause });
      return [];
    }
  }

  /** Takes over closed tabs' edits: each applied, then held as this tab's, then theirs removed. */
  async adopt(orphans: readonly HeldEdits[], apply: (update: Uint8Array) => Promise<void>): Promise<void> {
    for (const held of orphans) {
      for (const update of held.updates) {
        await apply(update);
        this.push(update);
      }
      await this.written();
      // Theirs go only once ours are on the device: a crash between keeps both, and a CRDT
      // merges the same update twice as once.
      if (this.local === 'written') await this.attempt('write', (cache: DocumentCache): Promise<void> => cache.saveEdits(this.nodeId, held.instance, []));
    }
  }

  push(update: Uint8Array): PendingUpdate {
    const entry: PendingUpdate = this.outbox.push(update);
    this.persist();
    this.host.changed();
    return entry;
  }

  /** The server acknowledged `clientSeq`: the edit leaves the outbox and this device. */
  settle(clientSeq: bigint): PendingUpdate | null {
    const entry: PendingUpdate | null = this.outbox.settle(clientSeq);
    if (!entry) return null;
    const through: bigint | null = this.syncThrough;
    if (through !== null && !this.outbox.all().some((e: PendingUpdate): boolean => e.clientSeq <= through)) this.syncThrough = null;
    this.persist();
    this.host.changed();
    return entry;
  }

  sendable(entry: PendingUpdate): boolean {
    return this.autoSaveNow || (this.syncThrough !== null && entry.clientSeq <= this.syncThrough);
  }

  /** Lets every edit made so far go; true when there was any. */
  requestSync(): boolean {
    const all: readonly PendingUpdate[] = this.outbox.all();
    const last: PendingUpdate | undefined = all[all.length - 1];
    if (!last) return false;
    this.syncThrough = last.clientSeq;
    this.host.changed();
    return true;
  }

  async setAutoSave(on: boolean): Promise<void> {
    this.autoSaveNow = on;
    this.host.changed();
    await this.attempt('write', (cache: DocumentCache): Promise<void> => cache.saveChoices(this.nodeId, { autoSave: on }));
  }

  /** Writes this tab's held edits and AutoSave choice again, as after their records were removed. */
  async rewrite(): Promise<void> {
    this.persist();
    await this.written();
    await this.attempt('write', (cache: DocumentCache): Promise<void> => cache.saveChoices(this.nodeId, { autoSave: this.autoSaveNow }));
  }

  /** Resolves once this device holds the outbox as it is now. */
  written(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  close(): void {
    this.closed = true;
    if (this.release) this.release();
    this.release = null;
  }

  private persist(): void {
    if (!this.cache) return;
    this.dirty = true;
    if (this.writing) return;
    this.writing = this.writeAll(this.cache).finally((): void => {
      this.writing = null;
      if (this.dirty) this.persist();
    });
  }

  private async writeAll(cache: DocumentCache): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      this.setLocal('writing');
      try {
        await cache.saveEdits(this.nodeId, this.instance, this.outbox.all().map((e: PendingUpdate): Uint8Array => e.update));
        if (!this.dirty) this.setLocal('written');
      } catch (cause: unknown) {
        this.setLocal('failed');
        this.host.report({ kind: 'cacheFailed', operation: 'write', cause });
      }
    }
  }

  private setLocal(state: LocalWrite): void {
    if (state === this.local) return;
    this.local = state;
    this.host.changed();
  }

  private async attempt(operation: 'write', run: (cache: DocumentCache) => Promise<void>): Promise<void> {
    if (!this.cache) return;
    try {
      await run(this.cache);
    } catch (cause: unknown) {
      this.host.report({ kind: 'cacheFailed', operation, cause });
    }
  }
}
