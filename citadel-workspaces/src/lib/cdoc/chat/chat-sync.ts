/**
 * One chat document kept in step with the chat's peer, directly over the P2P channel: no
 * workspace server, so its content never leaves the two agents.
 *
 * On start and on every (re)connect each side sends `hello` with its state vector; the other
 * answers with the diff that side lacks, in chunks under the wire bound, and with a hello of
 * its own when the first was not already an answer. Every local edit is sent as an `update`.
 * The CRDT absorbs duplicates and any order, so there is no acknowledgement: a message lost on
 * the way is in the next diff. An update that left operations waiting for something this
 * replica lacks asks for it with a hello. A payload in another CRDT format is refused and
 * reported, never applied. The title is last-writer-wins, carried by `rename` and every hello.
 * A copy moved from another original than the peer's is held apart (chat-migration-gate.ts).
 */
import type { CdocChatSync, CdocChatSyncPayload, CdocChatTitleStamp } from '@/types/cdoc-chat-sync';
import { validateDocTitle, type TitleCheck } from '@/lib/live-document-store/doc-title';
import type { EditorController, RemoteApplied } from '../editor/controller';
import type { PeerPresence } from '../editor/peer-overlay';
import { DocumentPresence } from '../collab/document-presence';
import type { Clock, PeerIdentity } from '../collab/ports';
import { SerialQueue } from '../collab/serial-queue';
import type { ChatSyncConfig } from './chat-config';
import { ChatOutbox } from './chat-outbox';
import type { ChatTransport, WallClock } from './chat-ports';
import type { ChatSyncProblem } from './chat-problems';
import { encodeChatSync, laterTitle, readChatSync } from './chat-wire';
import { MigrationGate } from './chat-migration-gate';

export interface ChatSyncPorts {
  readonly transport: ChatTransport;
  readonly clock: Clock;
  readonly wallClock: WallClock;
  readonly identify: PeerIdentity;
}

export interface ChatSyncHost {
  report(problem: ChatSyncProblem): void;
  /** An update this replica made or applied, in that order: what the device copy records. */
  applied(update: Uint8Array): void;
  /** A title won, ours or the peer's. */
  titled(stamp: CdocChatTitleStamp): void;
  /** The peers drawn on the pages now. */
  peers(peers: readonly PeerPresence[]): void;
  /** The peer's copy was moved from another original (`theirs`): the two are held apart from now on. */
  heldApart(theirs: string | null): void;
}

export interface ChatDocumentState {
  readonly docId: string;
  readonly migrationOrigin: string | null;
  readonly title: CdocChatTitleStamp | null;
  /** Held apart from the peer's copy when it was last open: nothing is exchanged. */
  readonly heldApart: boolean;
}

class TooLarge extends Error {}

export class ChatDocumentSync {
  private readonly queue: SerialQueue;
  private readonly presence: DocumentPresence;
  private readonly outbox: ChatOutbox;
  private readonly gate: MigrationGate;
  private readonly unbind: (() => void)[] = [];
  private title: CdocChatTitleStamp | null;
  private cancelAsk: (() => void) | null = null;
  private stopped: boolean = false;

  constructor(
    private readonly config: ChatSyncConfig,
    private readonly state: ChatDocumentState,
    private readonly editor: EditorController,
    private readonly ports: ChatSyncPorts,
    private readonly host: ChatSyncHost,
  ) {
    this.title = state.title;
    this.gate = new MigrationGate(state.migrationOrigin, state.heldApart);
    this.queue = new SerialQueue((cause: unknown): void => host.report({ kind: 'editorFailed', operation: 'run a sync step', cause }));
    this.presence = new DocumentPresence(config.presence, {
      clock: ports.clock,
      identify: ports.identify,
      send: (record: Uint8Array): Promise<void> => this.send({ kind: 'awareness', record }),
    }, this.queue, {
      report: (problem): void => host.report(problem),
      linkUp: (): boolean => !this.stopped,
      editor: (): EditorController | null => (this.stopped ? null : editor),
      publish: (peers: readonly PeerPresence[]): void => host.peers(peers),
    });
    this.outbox = new ChatOutbox(ports.clock, config.updateCoalesceMs, config.maxMessageBytes, {
      send: (updates: readonly Uint8Array[]): void => { void this.sendAwaited('update', { kind: 'update', updates }); },
      // Too large for one message: the peer's answer to a hello carries it, chunked.
      oversized: (): void => { void this.queue.run((): Promise<void> => this.sendHello(false)); },
    });
  }

  start(): void {
    const { transport } = this.ports;
    this.unbind.push(
      transport.onMessage((payload: CdocChatSyncPayload): void => {
        if (payload.doc_id === this.state.docId) void this.queue.run((): Promise<void> => this.received(payload));
      }),
      transport.onConnected((): void => this.greet()),
      this.editor.on('change', ({ update }: { readonly update: Uint8Array }): void => {
        this.host.applied(update);
        this.outbox.add(update);
      }),
      this.editor.on('selection', (): void => this.presence.moved()),
      this.editor.on('pages', ({ dirtyPages }: { readonly dirtyPages: readonly number[] }): void => { void this.presence.repainted(dirtyPages); }),
    );
    this.greet();
  }

  /** Renames the document for both sides; throws when the title is not one (empty, too long). */
  rename(raw: string): CdocChatTitleStamp {
    const checked: TitleCheck = validateDocTitle(raw);
    if (!checked.ok) throw new Error(checked.reason);
    // Never earlier than the title it replaces, whatever this device's clock says.
    const at: number = Math.max(this.ports.wallClock(), this.title === null ? 0 : this.title.at + 1);
    const stamp: CdocChatTitleStamp = { title: checked.title, at, by: this.ports.transport.selfCid };
    this.adoptTitle(stamp);
    void this.sendAwaited('rename', { kind: 'rename', title: stamp });
    return stamp;
  }

  /** Every queued step has run (sends have been handed to the transport). */
  settled(): Promise<void> {
    return this.queue.idle();
  }

  /** Sends what the outbox holds, and stops. */
  stop(): void {
    if (this.stopped) return;
    this.outbox.flush();
    this.stopped = true;
    for (const unbind of this.unbind.splice(0)) unbind();
    if (this.cancelAsk !== null) this.cancelAsk();
    this.cancelAsk = null;
    this.presence.stop();
  }

  private greet(): void {
    void this.queue.run((): Promise<void> => this.sendHello(false));
    this.presence.moved();
  }

  private async received(payload: CdocChatSyncPayload): Promise<void> {
    if (this.stopped) return;
    if (payload.doc_version !== this.config.docVersion) {
      this.host.report({ kind: 'docVersionMismatch', expected: this.config.docVersion, received: payload.doc_version, where: 'the peer' });
      return;
    }
    let sync: CdocChatSync;
    try {
      sync = readChatSync(payload);
    } catch (cause: unknown) {
      this.host.report({ kind: 'unreadable', what: `A ${payload.sync.kind} message from the other person`, cause });
      return;
    }
    if (this.gate.apart && sync.kind !== 'hello') return;
    switch (sync.kind) {
      case 'hello': return this.answer(sync);
      case 'diff': return this.apply([sync.chunk], 'apply the other person\'s copy');
      case 'update': return this.apply(sync.updates, 'apply the other person\'s edit');
      case 'awareness':
        void this.presence.heard(this.ports.transport.peerCid, sync.record);
        return;
      case 'rename':
        if (laterTitle(this.title, sync.title)) this.adoptTitle(sync.title);
    }
  }

  private async answer(hello: Extract<CdocChatSync, { kind: 'hello' }>): Promise<void> {
    const wasApart: boolean = this.gate.apart;
    if (wasApart || this.gate.holdsApart(hello.migration_origin)) {
      if (!wasApart) {
        this.host.report({ kind: 'migrationMismatch', ours: this.state.migrationOrigin, theirs: hello.migration_origin });
        this.host.heldApart(hello.migration_origin);
      }
      // A hello and nothing else, so the peer learns it too.
      if (!hello.answer) await this.sendHello(true);
      return;
    }
    if (hello.title !== null && laterTitle(this.title, hello.title)) this.adoptTitle(hello.title);
    let chunks: Uint8Array[];
    try {
      chunks = await this.editor.encodeDiffChunked(hello.state_vector, this.config.maxChunkBytes);
    } catch (cause: unknown) {
      this.host.report({ kind: 'editorFailed', operation: 'compute what the other person lacks', cause });
      return;
    }
    for (const [index, chunk] of chunks.entries()) await this.sendAwaited('diff', { kind: 'diff', chunk, index, count: chunks.length });
    if (!hello.answer) await this.sendHello(true);
  }

  private async apply(updates: readonly Uint8Array[], operation: string): Promise<void> {
    for (const update of updates) {
      let applied: RemoteApplied;
      try {
        applied = await this.editor.applyRemote(update);
      } catch (cause: unknown) {
        this.host.report({ kind: 'editorFailed', operation, cause });
        continue;
      }
      this.host.applied(update);
      if (applied.remote !== null && (applied.remote.missing !== null || applied.remote.dropped > 0n)) this.askSoon();
    }
  }

  /** Operations wait for something this replica lacks: once the burst has had time to land, ask for it. */
  private askSoon(): void {
    if (this.cancelAsk !== null) return;
    this.cancelAsk = this.ports.clock.after(this.config.askAfterMs, (): void => {
      this.cancelAsk = null;
      void this.queue.run((): Promise<void> => this.sendHello(false));
    });
  }

  private async sendHello(answer: boolean): Promise<void> {
    if (this.stopped) return;
    const stateVector: Uint8Array = await this.editor.stateVector();
    await this.sendAwaited('hello', { kind: 'hello', state_vector: stateVector, answer, migration_origin: this.state.migrationOrigin, title: this.title });
  }

  private adoptTitle(stamp: CdocChatTitleStamp): void {
    this.title = stamp;
    this.host.titled(stamp);
  }

  /** Sends `sync`; a failure is reported (the next hello heals what it carried), never thrown. */
  private async sendAwaited(what: string, sync: CdocChatSync): Promise<void> {
    try {
      await this.send(sync);
    } catch (cause: unknown) {
      if (!(cause instanceof TooLarge)) this.host.report({ kind: 'sendFailed', request: `document ${what}`, cause });
    }
  }

  /** Encodes and sends `sync`, refusing (and reporting) one over the wire bound. */
  private send(sync: CdocChatSync): Promise<void> {
    // Held apart, only a hello leaves: it carries what the copy was moved from, never its content.
    if (this.stopped || (this.gate.apart && sync.kind !== 'hello')) return Promise.resolve();
    const bytes: Uint8Array = encodeChatSync({ doc_id: this.state.docId, doc_version: this.config.docVersion, sync });
    if (bytes.byteLength > this.config.maxMessageBytes) {
      this.host.report({ kind: 'tooLarge', what: sync.kind === 'awareness' ? 'awareness' : 'update', sizeBytes: bytes.byteLength, maxBytes: this.config.maxMessageBytes });
      return Promise.reject(new TooLarge(sync.kind));
    }
    return this.ports.transport.send(bytes);
  }
}
