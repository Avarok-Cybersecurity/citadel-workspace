/**
 * The session's local copy of its document (the DocumentCache port, or none): read once on
 * open, kept as the base the document opens from offline, removed when the node is gone or no
 * longer readable. A failure is reported, never thrown: without the copy the document is
 * pulled whole, and a copy that could not be written or removed is said so.
 */
import type { EditorController } from '../editor/controller';
import type { CachedDocument, Clock, DocumentSessionPorts } from './ports';
import type { DocumentSessionProblem } from './session-errors';

/** The replica as it stands when the base is due: `exact` when it is the log's `1..=seq` and nothing of ours is unacknowledged. */
export interface ReplicaNow {
  readonly editor: EditorController | null;
  readonly seq: bigint;
  readonly exact: boolean;
}

export interface BaseTiming {
  readonly clock: Clock;
  readonly idleMs: number;
  /** Runs `step` on the session's queue. */
  run(step: () => Promise<void>): void;
}

export class CachedCopy {
  private savedSeq: bigint | null = null;
  private cancelBase: (() => void) | null = null;

  constructor(
    private readonly nodeId: string,
    private readonly docVersion: number,
    private readonly cache: DocumentSessionPorts['cache'],
    private readonly report: (problem: DocumentSessionProblem) => void,
    private readonly timing: BaseTiming,
    private readonly now: () => ReplicaNow,
  ) {}

  async load(): Promise<CachedDocument | null> {
    if (!this.cache) return null;
    try {
      const cached: CachedDocument | null = await this.cache.load(this.nodeId);
      if (cached) this.savedSeq = cached.seq;
      return cached;
    } catch (cause: unknown) {
      this.report({ kind: 'cacheFailed', operation: 'read', cause });
      return null;
    }
  }

  /**
   * The replica moved: once it has been still for `idleMs`, it is kept as the base. A snapshot
   * per keystroke would rewrite the whole document on every acknowledgement.
   */
  moved(): void {
    if (!this.cache) return;
    this.stop();
    this.cancelBase = this.timing.clock.after(this.timing.idleMs, (): void => {
      this.cancelBase = null;
      this.timing.run((): Promise<void> => this.saveBase());
    });
  }

  stop(): void {
    if (this.cancelBase) this.cancelBase();
    this.cancelBase = null;
  }

  /**
   * Keeps the replica as the base this device opens from, once per seq, when it is exactly the
   * log's `1..=seq` and holds nothing of ours the server has not acknowledged (`exact`): edits
   * not yet sent are kept apart, in LocalEdits, so the base never holds what the log does not.
   */
  private async saveBase(): Promise<void> {
    const { editor, seq, exact } = this.now();
    if (!this.cache || !editor || !exact || seq === this.savedSeq) return;
    try {
      await this.cache.save(this.nodeId, { docVersion: this.docVersion, snapshot: await editor.snapshot(), seq });
      this.savedSeq = seq;
    } catch (cause: unknown) {
      this.report({ kind: 'cacheFailed', operation: 'write', cause });
    }
  }

  /** The node is gone or no longer ours to read: its decrypted copy leaves this device. */
  async forget(): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.forget(this.nodeId);
    } catch (cause: unknown) {
      this.report({ kind: 'cacheFailed', operation: 'forget', cause });
    }
  }
}
