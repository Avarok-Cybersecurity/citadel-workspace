/**
 * A Citadel Docs document open for real-time collaboration: one editor replica kept in step
 * with its node's log on the workspace server (the kernel's Documents sub-protocol), with the
 * other people in it drawn on its pages.
 *
 * The session never decides what the bytes mean: updates, snapshots and awareness records are
 * the editor's, and the server orders, stores and relays them. What it owns is ordering (pull
 * in sequence, close every gap, never apply an update twice), delivery (every local update is
 * appended until acknowledged, again after a reconnect), and reporting: every refusal, format
 * mismatch and denied permission is emitted as a `problem`, never dropped.
 */
import type { DocumentRefusal, DocumentsResponse } from 'citadel-workspace-client-ts';
import { accessOf, accessOfError, type DeniedAccess } from './denied-access';
import type { EditorController } from '../editor/controller';
import type { PeerPresence } from '../editor/peer-overlay';
import { DocumentPresence, type PresencePorts, type PresenceSettings } from './document-presence';
import { DocumentSync } from './document-sync';
import type { DocumentSessionConfig, DocumentSessionPorts, LinkState } from './ports';
import { SerialQueue } from './serial-queue';
import { DocumentSessionError, type DocumentSessionProblem } from './session-errors';
import { isRecordLocked } from '@/lib/at-rest/at-rest-shape';
import { fromWire, toWire } from './wire-bytes';
import type { SaveInputs } from '@/lib/document-save/save-status';

export interface DocumentSessionEvents {
  /** A replica was opened: the first, or a re-open over a newer snapshot. Draw this one. */
  editor: EditorController;
  problem: DocumentSessionError;
  peers: readonly PeerPresence[];
  /** Where this tab's edits are (save-status.ts reads it): emitted whenever any of it changes. */
  save: SaveInputs;
}

type Listeners = { [E in keyof DocumentSessionEvents]: Set<(payload: DocumentSessionEvents[E]) => void> };

export class DocumentSession {
  private readonly queue: SerialQueue;
  private readonly sync: DocumentSync;
  private readonly presence: DocumentPresence;
  private readonly listeners: Listeners = { editor: new Set(), problem: new Set(), peers: new Set(), save: new Set() };
  private readonly unsubscribe: (() => void)[] = [];
  private unbindEditor: (() => void) | null = null;
  private link: LinkState = 'up';
  private closed: boolean = false;
  private locked: boolean = false;

  constructor(private readonly config: DocumentSessionConfig, private readonly ports: DocumentSessionPorts) {
    // A sealed copy that cannot be opened here is a state the title bar shows, not a notice.
    const report = (problem: DocumentSessionProblem): void => {
      if (problem.kind === 'cacheFailed' && isRecordLocked(problem.cause)) this.lock(true);
      else this.emit('problem', new DocumentSessionError(problem));
    };
    this.queue = new SerialQueue((cause: unknown): void => report({ kind: 'editorFailed', operation: 'run a session step', cause }));
    const linkUp = (): boolean => this.link === 'up' && !this.closed;
    this.sync = new DocumentSync(config, ports, {
      report,
      linkUp,
      adopt: (editor: EditorController): void => this.adopt(editor),
      alone: (): boolean => this.presence.alone(),
      run: (step: () => Promise<void>): void => { void this.queue.run(step); },
      changed: (): void => this.emit('save', this.saveInputs),
    });
    this.presence = new DocumentPresence(relayPresence(config), relayPresencePorts(config, ports), this.queue, {
      report,
      // With AutoSave off, a caret moving over text nobody else has would say where the edits are.
      linkUp: (): boolean => linkUp() && this.sync.autoSave,
      editor: (): EditorController | null => this.sync.editor,
      publish: (peers: readonly PeerPresence[]): void => this.emit('peers', peers),
    });
  }

  /** Subscribes first, then pulls: a push that lands mid-open is queued behind the pull. */
  open(): Promise<void> {
    const { transport } = this.ports;
    this.link = transport.link();
    this.emit('save', this.saveInputs);
    this.unsubscribe.push(
      transport.onResponse((response: DocumentsResponse): void => this.received(response)),
      transport.onError((message: string): void => this.denied(accessOfError(message), message)),
      transport.onLink((state: LinkState): void => this.linkChanged(state)),
    );
    return this.queue.run((): Promise<void> => this.sync.start());
  }

  get editor(): EditorController | null {
    return this.sync.editor;
  }

  /** The last log seq the replica holds, in order. */
  get seq(): bigint {
    return this.sync.seq;
  }

  get saveInputs(): SaveInputs {
    return { ...this.sync.saveInputs(), link: this.link, locked: this.locked };
  }

  /** The account this session edits as. */
  get account(): bigint {
    return this.ports.transport.selfCid;
  }

  /** Whether the copies this device cannot open include edits that were never sent. */
  async lockedCopiesHoldEdits(): Promise<boolean> {
    if (!this.ports.cache) return false;
    return this.ports.cache.loadEdits(this.config.nodeId).then((): boolean => false, (error: unknown): boolean => isRecordLocked(error));
  }

  /** Writes this tab's held edits to this device again: Try again, after a write failed. */
  keepAgain(): Promise<void> {
    return this.queue.run((): Promise<void> => this.sync.keepAgain());
  }

  /** Removes the copies this device cannot open (asked first, by the caller) and keeps this tab's again. */
  async removeLockedCopies(): Promise<void> {
    if (this.ports.cache) await this.ports.cache.forget(this.config.nodeId);
    this.lock(false);
    await this.queue.run((): Promise<void> => this.sync.keepAgain());
  }

  private lock(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    this.emit('save', this.saveInputs);
  }

  /** Save: with AutoSave off, sends every edit made so far. */
  save(): Promise<void> {
    return this.queue.run((): Promise<void> => this.sync.save());
  }

  async setAutoSave(on: boolean): Promise<void> {
    await this.queue.run((): Promise<void> => this.sync.setAutoSave(on));
    // Back in view: peers hear where this caret is now, not at the next move.
    if (on) this.presence.moved();
  }

  /** Every queued step has run and this device holds the edits (for callers that must wait). */
  async settled(): Promise<void> {
    await this.queue.idle();
    await this.sync.written();
  }

  on<E extends keyof DocumentSessionEvents>(event: E, listener: (payload: DocumentSessionEvents[E]) => void): () => void {
    const set: Set<(payload: DocumentSessionEvents[E]) => void> = this.listeners[event];
    set.add(listener);
    return (): void => { set.delete(listener); };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const stop of this.unsubscribe.splice(0)) stop();
    this.presence.stop();
    this.sync.stop();
    if (this.unbindEditor) this.unbindEditor();
    this.unbindEditor = null;
  }

  private received(response: DocumentsResponse): void {
    if (this.closed || !concernsNode(response, this.config.nodeId)) return;
    if ('DocumentAwareness' in response) {
      void this.presence.heard(response.DocumentAwareness.from_cid, fromWire(response.DocumentAwareness.payload));
      return;
    }
    if ('AwarenessRelayed' in response) return;
    // A chat document's channel refused: its answer names the document, so it is this session's.
    const refused: unknown = 'Refused' in response ? response.Refused : null;
    if (typeof refused === 'object' && refused !== null && 'ChatDocumentDenied' in refused) {
      const { permission } = (refused as Extract<DocumentRefusal, { ChatDocumentDenied: unknown }>).ChatDocumentDenied;
      return this.denied(accessOf(permission), `Permission denied: ${permission} required`);
    }
    void this.queue.run((): Promise<void> => this.sync.onResponse(response));
  }

  private denied(access: DeniedAccess | null, message: string): void {
    if (access !== null) void this.queue.run((): Promise<void> => this.sync.onPermissionDenied(access, message));
  }

  private linkChanged(state: LinkState): void {
    if (this.closed || state === this.link) return;
    this.link = state;
    this.emit('save', this.saveInputs);
    if (state === 'down') {
      this.sync.onLinkDown();
      return;
    }
    void this.queue.run((): Promise<void> => this.sync.onLinkUp());
    this.presence.moved();
  }

  private adopt(editor: EditorController): void {
    if (this.unbindEditor) this.unbindEditor();
    const bindings: (() => void)[] = [
      editor.on('change', ({ update }: { readonly update: Uint8Array }): void => { void this.queue.run((): Promise<void> => this.sync.local(update)); }),
      editor.on('selection', (): void => this.presence.moved()),
      editor.on('pages', ({ dirtyPages }: { readonly dirtyPages: readonly number[] }): void => { void this.presence.repainted(dirtyPages); }),
    ];
    this.unbindEditor = (): void => { for (const unbind of bindings) unbind(); };
    this.emit('editor', editor);
    this.presence.moved();
  }

  private emit<E extends keyof DocumentSessionEvents>(event: E, payload: DocumentSessionEvents[E]): void {
    for (const listener of [...this.listeners[event]]) listener(payload);
  }
}

/** Presence over the kernel's relay: its limits, and the Awareness request for the node. */
function relayPresence(config: DocumentSessionConfig): PresenceSettings {
  const { awarenessHeartbeatMs, peerExpiryMs, maxCaretsPerSession } = config;
  return { awarenessPerSecond: config.limits.awarenessPerSecond, maxAwarenessBytes: config.limits.maxAwarenessBytes, awarenessHeartbeatMs, peerExpiryMs, maxCaretsPerSession };
}

function relayPresencePorts(config: DocumentSessionConfig, ports: DocumentSessionPorts): PresencePorts {
  return {
    clock: ports.clock,
    identify: ports.identify,
    send: (record: Uint8Array): Promise<void> => ports.transport.send({ Awareness: { node_id: config.nodeId, payload: toWire(record) } }),
  };
}

/** Whether a Documents response is about `nodeId`; a refusal naming no node is every session's. */
export function concernsNode(response: DocumentsResponse, nodeId: string): boolean {
  const body: unknown = Object.values(response)[0];
  if ('Refused' in response) {
    const refusal: unknown = response.Refused;
    if (typeof refusal === 'string') return true;
    const detail: unknown = Object.values(refusal as Record<string, unknown>)[0];
    return !isRecord(detail) || detail.node_id === nodeId;
  }
  return isRecord(body) && body.node_id === nodeId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
