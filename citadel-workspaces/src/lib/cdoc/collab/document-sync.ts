/**
 * One replica kept in step with a node's update log: pulled in order on open and after every
 * gap, local updates appended, peers' updates applied, a snapshot stored when due.
 *
 * Every step runs on the session's SerialQueue, so the cursor, the outbox and the editor are
 * only ever touched by one step at a time.
 */
import type { DocumentRefusal, DocumentsRequest, DocumentsResponse } from 'citadel-workspace-client-ts';
import type { EditorController } from '../editor/controller';
import type { LogCursor } from './log-cursor';
import type { PendingUpdate } from './outbox';
import { LocalEdits } from './local-edits';
import type { CachedDocument, DocumentSessionConfig, DocumentSessionPorts, HeldEdits } from './ports';
import type { SaveInputs } from '@/lib/document-save/save-status';
import { haltsWriting, type DocumentSessionProblem } from './session-errors';
import type { DeniedAccess } from './denied-access';
import { CachedCopy, type ReplicaNow } from './cached-copy';
import { HeldRequests } from './refused-retry';
import { toWire } from './wire-bytes';
import { ReplicaInStep } from './replica-in-step';
import { PacedSends } from './request-pacer';
import { SnapshotPolicy, type SnapshotHost } from './snapshot-policy';

type Updates = Extract<DocumentsResponse, { Updates: unknown }>['Updates'];
type Updated = Extract<DocumentsResponse, { DocumentUpdated: unknown }>['DocumentUpdated'];
type Appended = Extract<DocumentsResponse, { Appended: unknown }>['Appended'];
type Compacted = Extract<DocumentsResponse, { DocumentCompacted: unknown }>['DocumentCompacted'];

export interface SyncHost {
  report(problem: DocumentSessionProblem): void;
  /** A replica was opened; `previous` (null on the first) is disposed after this returns. */
  adopt(editor: EditorController, previous: EditorController | null): void;
  linkUp(): boolean;
  alone(): boolean;
  /** Something saveInputs() reads has changed. */
  changed(): void;
  /** Runs `step` on the session's queue, after the steps before it. */
  run(step: () => Promise<void>): void;
}

export class DocumentSync {
  private readonly replica: ReplicaInStep;
  private readonly edits: LocalEdits;
  private readonly snapshots: SnapshotPolicy;
  private readonly copy: CachedCopy;
  private readonly held: HeldRequests;
  private readonly paced: PacedSends;
  private cancelPullTimer: (() => void) | null = null;
  private writable: boolean = true;
  private readable: boolean = true;

  constructor(private readonly config: DocumentSessionConfig, private readonly ports: DocumentSessionPorts, private readonly host: SyncHost) {
    this.replica = new ReplicaInStep(config.docVersion, ports.openEditor, host);
    this.edits = new LocalEdits(config, ports.cache, { report: host.report, changed: host.changed });
    const snapshotHost: SnapshotHost = { report: host.report, linkUp: host.linkUp, alone: host.alone, writable: (): boolean => this.writable };
    this.snapshots = new SnapshotPolicy(config, ports, snapshotHost, (request: DocumentsRequest, name: string): Promise<void> => this.send(request, name));
    this.copy = new CachedCopy(config.nodeId, config.docVersion, ports.cache, host.report, { clock: ports.clock, idleMs: config.baseAfterIdleMs, run: host.run },
      (): ReplicaNow => ({ editor: this.replica.editor, seq: this.replica.cursor.seq, exact: this.caughtUp }));
    this.paced = new PacedSends(ports.pacing, (request: DocumentsRequest, name: string): Promise<void> => this.send(request, name));
    this.held = new HeldRequests(ports.clock, config.retryDelaysMs, (): void => host.run((): Promise<void> => this.resend()),
      (): void => host.run((): Promise<void> => this.pull()), (refusal: DocumentRefusal): void => host.report({ kind: 'refused', refusal }));
  }

  get editor(): EditorController | null {
    return this.replica.editor;
  }

  get seq(): bigint {
    return this.replica.cursor.seq;
  }

  get caughtUp(): boolean {
    return this.cancelPullTimer === null && this.edits.empty && this.replica.cursor.contiguous;
  }

  get autoSave(): boolean {
    return this.edits.autoSave;
  }

  saveInputs(): Omit<SaveInputs, 'link' | 'locked'> {
    return { ...this.edits.inputs(), halted: !this.writable };
  }

  written(): Promise<void> {
    return this.edits.written();
  }

  /** Opens from this device's copy, takes over closed tabs' edits, then pulls what is newer. */
  async start(): Promise<void> {
    const orphans: readonly HeldEdits[] = await this.edits.open();
    const cached: CachedDocument | null = await this.copy.load();
    if (cached && this.replica.versionOk(cached.docVersion, 'the cached snapshot')) {
      await this.replica.open({ kind: 'snapshot', snapshot: cached.snapshot }, cached.seq);
    }
    if (!this.replica.editor && orphans.length > 0) await this.replica.open({ kind: 'blank' }, 0n);
    await this.edits.adopt(orphans, (update: Uint8Array): Promise<void> => this.replica.applyHeld(update));
    // Taken-over edits go now if they may (AutoSave on), not at the next link change.
    await this.resend();
    await this.pull();
  }

  /** Save: with AutoSave off, every edit made so far goes (with it on they are going already). */
  async save(): Promise<void> {
    if (!this.edits.autoSave && this.edits.requestSync()) await this.resend();
  }

  async setAutoSave(on: boolean): Promise<void> {
    await this.edits.setAutoSave(on);
    if (on) await this.resend();
  }

  async onLinkUp(): Promise<void> {
    await this.resend();
    await this.pull();
  }

  /** Queues every update the server has not acknowledged again, in order, at the kernel's pace. */
  private async resend(): Promise<void> {
    if (!this.writable || !this.host.linkUp()) return;
    for (const entry of this.edits.all()) if (this.edits.sendable(entry)) this.sendAppend(entry);
  }

  /** Copies this device could not open were removed: this tab's held edits are written again. */
  keepAgain(): Promise<void> { return this.edits.rewrite(); }

  onLinkDown(): void {
    this.stopPullTimer();
    this.snapshots.abandon();
  }

  async local(update: Uint8Array): Promise<void> {
    if (update.byteLength > this.config.limits.maxUpdateBytes) {
      this.halt();
      this.host.report({ kind: 'tooLarge', what: 'update', sizeBytes: update.byteLength, maxBytes: this.config.limits.maxUpdateBytes });
      return;
    }
    const entry: PendingUpdate = this.edits.push(update.slice());
    if (this.writable && this.host.linkUp() && this.edits.sendable(entry)) this.sendAppend(entry);
    this.snapshots.countLocal();
  }

  async onResponse(response: DocumentsResponse): Promise<void> {
    if ('Updates' in response) await this.onUpdates(response.Updates);
    else if ('DocumentUpdated' in response) await this.onUpdated(response.DocumentUpdated);
    else if ('Appended' in response) await this.onAppended(response.Appended);
    else if ('SnapshotStored' in response) await this.snapshots.stored(response.SnapshotStored.upto_seq);
    else if ('DocumentCompacted' in response) await this.onCompacted(response.DocumentCompacted);
    else if ('Refused' in response) await this.onRefused(response.Refused);
  }

  /** A refused permission; only ours when we have that kind of request out. */
  async onPermissionDenied(access: DeniedAccess, message: string): Promise<void> {
    const writeDenied: boolean = access === 'write' && (!this.edits.empty || this.snapshots.inFlight);
    const readDenied: boolean = access === 'read' && this.cancelPullTimer !== null;
    if (!writeDenied && !readDenied) return;
    if (writeDenied) this.halt();
    if (readDenied) { this.readable = false; this.stopPullTimer(); }
    this.host.report({ kind: 'permissionDenied', message });
    if (readDenied) await this.copy.forget();
  }

  stop(): void {
    this.paced.forget();
    this.stopPullTimer();
    this.held.stop();
    this.copy.stop();
    this.edits.close();
  }

  private async onUpdates(page: Updates): Promise<void> {
    this.stopPullTimer();
    this.held.pulls.succeeded();
    if (page.snapshot && page.snapshot.upto_seq > this.replica.cursor.seq && !(await this.replica.adoptSnapshot(page.snapshot, (): readonly PendingUpdate[] => this.edits.all()))) return;
    if (!this.replica.editor) await this.replica.open({ kind: 'blank' }, this.replica.cursor.seq);
    let gap: boolean = false;
    for (const entry of page.updates) {
      if (!this.replica.versionOk(entry.doc_version, `update ${entry.seq}`)) return;
      const placement: ReturnType<LogCursor['place']> = this.replica.cursor.place(entry.seq);
      if (placement === 'gap') { gap = true; break; }
      if (placement === 'next') await this.replica.applyNext(entry.seq, entry.update);
    }
    if (gap || page.has_more || page.latest_seq > this.replica.cursor.seq) await this.pull();
    else await this.snapshots.consider(this.replica.editor, this.replica.cursor.seq, this.caughtUp);
    this.copy.moved();
  }

  private async onUpdated(pushed: Updated): Promise<void> {
    if (!this.replica.editor || !this.replica.versionOk(pushed.doc_version, `update ${pushed.seq}`)) return;
    const placement: ReturnType<LogCursor['place']> = this.replica.cursor.place(pushed.seq);
    if (placement === 'next') await this.replica.applyNext(pushed.seq, pushed.update);
    else if (placement === 'gap') await this.pull();
    this.copy.moved();
  }

  private async onAppended(answer: Appended): Promise<void> {
    const ours: PendingUpdate | null = this.edits.settle(answer.client_seq);
    // Not ours: another tab of this account wrote it, and the server sends an author's own
    // session no DocumentUpdated, so the bytes are only to be had by pulling.
    if (!ours) {
      if (this.replica.cursor.place(answer.seq) !== 'old') await this.pull();
      return;
    }
    this.held.appends.succeeded();
    if (!this.replica.cursor.own(answer.seq)) await this.pull();
    if (answer.compaction) this.snapshots.requested();
    await this.snapshots.consider(this.replica.editor, this.replica.cursor.seq, this.caughtUp);
    this.copy.moved();
  }

  /** The server stored a snapshot to `upto_seq`, the log's latest: a held-back Append can go. */
  private async onCompacted(compacted: Compacted): Promise<void> {
    this.held.appends.now();
    if (compacted.upto_seq > this.replica.cursor.seq) await this.pull();
  }

  private async onRefused(refusal: DocumentRefusal): Promise<void> {
    if (this.held.refused(refusal)) return;
    if (haltsWriting(refusal)) this.halt();
    if (typeof refusal !== 'string' && ('SnapshotBehind' in refusal || 'SnapshotAhead' in refusal || 'SnapshotTooLarge' in refusal)) this.snapshots.abandon();
    this.host.report({ kind: 'refused', refusal });
    if (typeof refusal !== 'string' && 'NoSuchNode' in refusal) await this.copy.forget();
  }

  private halt(): void {
    this.writable = false;
    this.host.changed();
  }

  private async pull(): Promise<void> {
    if (!this.readable || !this.host.linkUp()) return;
    this.stopPullTimer();
    this.cancelPullTimer = this.ports.clock.after(this.config.pullTimeoutMs, (): void => { this.cancelPullTimer = null; void this.pull(); });
    this.paced.pull((): DocumentsRequest | null => (this.readable && this.host.linkUp() ? { Pull: { node_id: this.config.nodeId, since_seq: this.replica.cursor.seq } } : null));
  }

  private stopPullTimer(): void { this.cancelPullTimer?.(); this.cancelPullTimer = null; }

  private sendAppend(entry: PendingUpdate): void {
    this.paced.append(entry.clientSeq, (): DocumentsRequest | null => (this.writable && this.host.linkUp() && this.edits.pending(entry) && this.edits.sendable(entry)
      ? { Append: { node_id: this.config.nodeId, doc_version: this.config.docVersion, update: toWire(entry.update), client_seq: entry.clientSeq } } : null));
  }

  private async send(request: DocumentsRequest, name: string): Promise<void> {
    try {
      await this.ports.transport.send(request);
    } catch (cause: unknown) {
      this.host.report({ kind: 'sendFailed', request: name, cause });
    }
  }
}
