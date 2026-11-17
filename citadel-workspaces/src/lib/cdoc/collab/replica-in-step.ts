/**
 * The replica a DocumentSync keeps in step, and where in the log it stands: opened (and
 * re-opened over a newer snapshot), each log update applied once in order, edits kept on this
 * device applied over it, every payload's format checked. Split from document-sync.ts, which
 * decides what to pull and send.
 */
import type { DocumentSnapshot } from 'citadel-workspace-client-ts';
import type { EditorController, EditorOpener, EditorOrigin, RemoteApplied } from '../editor/controller';
import { LogCursor } from './log-cursor';
import type { PendingUpdate } from './outbox';
import type { DocumentSessionProblem } from './session-errors';
import { fromWire } from './wire-bytes';

export interface ReplicaHost {
  report(problem: DocumentSessionProblem): void;
  /** A replica was opened; `previous` (null on the first) is disposed after this returns. */
  adopt(editor: EditorController, previous: EditorController | null): void;
}

export class ReplicaInStep {
  private editorNow: EditorController | null = null;
  private cursorNow: LogCursor = new LogCursor(0n);

  constructor(private readonly docVersion: number, private readonly openEditor: EditorOpener, private readonly host: ReplicaHost) {}

  get editor(): EditorController | null {
    return this.editorNow;
  }

  get cursor(): LogCursor {
    return this.cursorNow;
  }

  async applyNext(seq: bigint, update: readonly number[]): Promise<void> {
    const editor: EditorController | null = this.editorNow;
    if (!editor) return;
    try {
      this.checkWaiting(await editor.applyRemote(fromWire(update)), `apply update ${seq}`);
    } catch (cause: unknown) {
      // Reported, then stepped over: holding the cursor here would stall this replica on one
      // peer's unreadable update for good, and pulling again would fetch the same bytes.
      this.host.report({ kind: 'editorFailed', operation: `apply update ${seq}`, cause });
    }
    this.cursorNow.advance(seq);
  }

  /**
   * An edit kept on this device, applied to the replica it was not made on: it may wait for
   * updates the Pull that follows brings, so waiting is not reported, only a failure.
   */
  async applyHeld(update: Uint8Array): Promise<void> {
    if (!this.editorNow) return;
    try {
      await this.editorNow.applyRemote(update.slice());
    } catch (cause: unknown) {
      this.host.report({ kind: 'editorFailed', operation: 'apply edits kept on this device', cause });
    }
  }

  /** Reports an applied update that left operations waiting or dropped (nothing applied in log order should). */
  private checkWaiting(applied: RemoteApplied, operation: string): void {
    if (applied.remote.missing !== null || applied.remote.dropped > 0n) this.host.report({ kind: 'updatesWaiting', operation, ...applied.remote });
  }

  /** Opens or re-opens from the snapshot; false when it cannot be read. */
  async adoptSnapshot(snapshot: DocumentSnapshot, unacknowledged: () => readonly PendingUpdate[]): Promise<boolean> {
    if (!this.versionOk(snapshot.doc_version, `the snapshot to ${snapshot.upto_seq}`)) return false;
    const previous: EditorController | null = this.editorNow;
    await this.open({ kind: 'snapshot', snapshot: fromWire(snapshot.bytes) }, snapshot.upto_seq);
    // A re-open lost what the old replica held past the snapshot: our unacknowledged edits
    // go into the new one (LocalEdits still holds them), and the log's later updates follow.
    const reopened: EditorController | null = previous ? this.editorNow : null;
    if (!reopened) return true;
    try {
      for (const entry of unacknowledged()) this.checkWaiting(await reopened.applyRemote(entry.update.slice()), 'carry unacknowledged edits into the re-opened replica');
    } catch (cause: unknown) {
      this.host.report({ kind: 'editorFailed', operation: 'carry unacknowledged edits into the re-opened replica', cause });
    }
    return true;
  }

  async open(from: EditorOrigin, seq: bigint): Promise<void> {
    const previous: EditorController | null = this.editorNow;
    const editor: EditorController = await this.openEditor(from);
    this.editorNow = editor;
    this.cursorNow = new LogCursor(seq);
    this.host.adopt(editor, previous);
    if (previous) previous.dispose();
  }

  versionOk(received: number, where: string): boolean {
    if (received === this.docVersion) return true;
    this.host.report({ kind: 'docVersionMismatch', expected: this.docVersion, received, where });
    return false;
  }
}
