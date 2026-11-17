/**
 * Who else is in the document and where their carets are: our awareness record out, paced to
 * the relay's limit; peers' records in, turned into rectangles on this replica's pages and
 * handed to the editor's PeerOverlay. Where the record goes is the caller's port: the
 * workspace server's relay for a workspace document, the P2P channel for a chat document.
 */
import type { EditorController, PeerView } from '../editor/controller';
import type { PeerPresence } from '../editor/peer-overlay';
import { AwarenessPacer } from './awareness-pacer';
import { PeerBook } from './peer-book';
import type { Clock, PeerIdentity } from './ports';
import type { SerialQueue } from './serial-queue';
import type { DocumentSessionProblem } from './session-errors';

/** Every setting is required (PCND); each transport states its own. */
export interface PresenceSettings {
  /** Records sent per second at most: the relay's limit. */
  readonly awarenessPerSecond: number;
  /** The largest record the relay carries; a larger one is reported, never sent. */
  readonly maxAwarenessBytes: number;
  /** Our record is re-sent this often while nothing moves, so peers do not expire us. */
  readonly awarenessHeartbeatMs: number;
  /** A peer not heard from for this long is no longer drawn. */
  readonly peerExpiryMs: number;
  /** The most carets one session's records may place. */
  readonly maxCaretsPerSession: number;
}

export interface PresencePorts {
  readonly clock: Clock;
  readonly identify: PeerIdentity;
  /** Hands our awareness record to the transport; resolves once it has left. */
  send(record: Uint8Array): Promise<void>;
}

/** What presence can go wrong with, in the session's own terms. */
export type PresenceProblem = Extract<DocumentSessionProblem, { readonly kind: 'sendFailed' | 'editorFailed' | 'tooLarge' }>;

export interface PresenceHost {
  report(problem: PresenceProblem): void;
  linkUp(): boolean;
  editor(): EditorController | null;
  publish(peers: readonly PeerPresence[]): void;
}

export class DocumentPresence {
  private readonly pacer: AwarenessPacer;
  private readonly book: PeerBook;
  private cancelSweep: (() => void) | null = null;

  constructor(
    private readonly settings: PresenceSettings,
    private readonly ports: PresencePorts,
    private readonly queue: SerialQueue,
    private readonly host: PresenceHost,
  ) {
    this.book = new PeerBook(ports.identify, settings.peerExpiryMs, settings.maxCaretsPerSession);
    const sendFailed = (cause: unknown): void => host.report({ kind: 'sendFailed', request: 'Awareness', cause });
    // In the session's queue: the record is read after the updates before it are applied, and
    // the session is not settled while a record is still on its way out.
    this.pacer = new AwarenessPacer(
      ports.clock,
      settings.awarenessPerSecond,
      settings.awarenessHeartbeatMs,
      (): Promise<void> => queue.run((): Promise<void> => this.sendRecord().catch(sendFailed)),
      sendFailed,
    );
  }

  /** Our selection moved, or the link came back. */
  moved(): void {
    this.pacer.request();
  }

  /** This replica repainted `dirtyPages` (none: only the page count changed). */
  repainted(dirtyPages: readonly number[]): Promise<void> {
    const fromPage: number | null = dirtyPages.length === 0 ? null : Math.min(...dirtyPages);
    return this.queue.run(async (): Promise<void> => {
      const editor: EditorController | null = this.host.editor();
      if (!editor || this.book.size === 0) return;
      await this.book.remap((record: Uint8Array): Promise<PeerView> => editor.peerView(record), fromPage);
      this.publish();
    });
  }

  heard(fromCid: bigint, record: Uint8Array): Promise<void> {
    return this.queue.run(async (): Promise<void> => {
      const editor: EditorController | null = this.host.editor();
      if (!editor) return;
      let view: PeerView;
      try {
        view = await editor.peerView(record);
      } catch (cause: unknown) {
        this.host.report({ kind: 'editorFailed', operation: `read the awareness of session ${fromCid.toString()}`, cause });
        return;
      }
      this.book.hear(fromCid, record, view, this.ports.clock.now());
      this.publish();
      this.armSweep();
    });
  }

  /** No other peer has been heard from within the expiry. */
  alone(): boolean {
    if (this.book.expire(this.ports.clock.now())) this.publish();
    return this.book.size === 0;
  }

  stop(): void {
    this.pacer.stop();
    if (this.cancelSweep) this.cancelSweep();
    this.cancelSweep = null;
    this.host.editor()?.peers.clear();
    this.host.publish([]);
  }

  private async sendRecord(): Promise<void> {
    const editor: EditorController | null = this.host.editor();
    if (!editor || !this.host.linkUp()) return;
    const record: Uint8Array = await editor.awareness();
    const max: number = this.settings.maxAwarenessBytes;
    if (record.byteLength > max) {
      this.host.report({ kind: 'tooLarge', what: 'awareness', sizeBytes: record.byteLength, maxBytes: max });
      return;
    }
    await this.ports.send(record);
  }

  private publish(): void {
    const peers: PeerPresence[] = this.book.presences();
    this.host.editor()?.peers.setPeers(peers);
    this.host.publish(peers);
  }

  private armSweep(): void {
    if (this.cancelSweep) return;
    this.cancelSweep = this.ports.clock.after(this.settings.peerExpiryMs, (): void => {
      this.cancelSweep = null;
      void this.queue.run(async (): Promise<void> => {
        if (this.book.expire(this.ports.clock.now())) this.publish();
        if (this.book.size > 0) this.armSweep();
      });
    });
  }
}
