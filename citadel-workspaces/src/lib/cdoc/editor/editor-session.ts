/**
 * The EditorController the page view and ribbons hold: commands become request records for
 * the worker's EditorHandle, results are decoded here, and only the pages a result names are
 * invalidated and repainted. Requests run one at a time in call order (a keystroke never
 * overtakes the one before it), and a failed command leaves the state as it was.
 */
import type { CdocClient } from '../worker/cdoc-client';
import type { PageRenderer } from '../paint/page-renderer';
import {
  COMMAND_OPCODES,
  SET_VIEWPORT_OPCODE,
  type AddedImage,
  type EditorCommand,
  type EditorCommandName,
  type EditorCommands,
  type EditorController,
  type EditorEvents,
  type EditorOrigin,
  type EditorPosition,
  type EditorState,
  type PeerView,
  type RemoteApplied,
  type SelectAt,
} from './controller';
import { Emitter } from './emitter';
import { encodeCommand } from './wire/encode-command';
import { decodeAddedImage, decodeAwareness, decodeCollected, decodePeerView, decodePosition, type Awareness, type Collected } from './wire/decode-records';
import { decodeResult, type EditorResult } from './wire/decode-result';
import { decodeChunks, decodeStyles, type DocumentStyle } from './wire/decode-v4-records';
import { readExportReport, readImportReport } from './file-reports';
import { RecordWriter } from './wire/record-writer';
import type { ExportedFile, ExportTarget, ImportReport } from './file-formats';
import type { EditorResults } from '../worker/editor-protocol';
import { PeerSet } from './peer-set';
import { sameValue } from './same-value';

export interface EditorSessionDeps {
  readonly client: CdocClient;
  readonly renderer: PageRenderer;
}

/** What the page view reads beyond the controller: page geometry and the peers to draw. */
export interface EditorView {
  readonly pageSizes: Int32Array;
  readonly peers: PeerSet;
  /** The element that takes keystrokes (the IME bridge's textarea), or null to detach it. */
  attachFocus(target: (() => void) | null): void;
  /** The pages on screen: results then carry selection rectangles for those and the repainted ones. */
  setViewport(pages: readonly number[]): Promise<EditorState>;
}

export class EditorSession implements EditorController, EditorView {
  private current: EditorState;
  private sizes: Int32Array;
  private queue: Promise<unknown> = Promise.resolve();
  private focusTarget: (() => void) | null = null;
  private disposed: boolean = false;
  private readonly events: Emitter<EditorEvents> = new Emitter<EditorEvents>();
  readonly peers: PeerSet = new PeerSet();
  readonly commands: EditorCommands;

  private constructor(private readonly deps: EditorSessionDeps, initial: EditorState, sizes: Int32Array, readonly importReport: ImportReport | null) {
    this.current = initial;
    this.sizes = sizes;
    // One method per command name, each building that command; the type is EditorCommands by
    // construction (a name from COMMAND_OPCODES plus that command's own fields).
    const entries: Array<[EditorCommandName, (args?: object) => Promise<EditorState>]> = (Object.keys(COMMAND_OPCODES) as EditorCommandName[]).map((name: EditorCommandName): [EditorCommandName, (args?: object) => Promise<EditorState>] => [
      name,
      (args?: object): Promise<EditorState> => this.execute({ ...args, name } as EditorCommand),
    ]);
    this.commands = Object.fromEntries(entries) as EditorCommands;
  }

  static async open(deps: EditorSessionDeps, client: bigint, from: EditorOrigin): Promise<EditorSession> {
    deps.renderer.reset();
    const opened: EditorResults['editorOpen'] = await deps.client.request({ kind: 'editorOpen', client, from });
    const own: Awareness = decodeAwareness(opened.awareness);
    const view: PeerView = decodePeerView(opened.view);
    const pageCount: number = opened.pageSizes.length / 2;
    return new EditorSession(deps, {
      anchor: own.anchor, head: own.head, caret: view.caret, selectionRects: view.selectionRects,
      caretPage: view.caret?.page ?? null, pageCount, composing: false, caretFormatting: { known: false },
      created: [], selectionText: { complete: true, text: '' }, story: { kind: 'body' },
    }, opened.pageSizes, from.kind === 'bytes' && opened.importReportJson !== null ? readImportReport(opened.importReportJson, from.format) : null);
  }

  get state(): EditorState {
    return this.current;
  }

  get pageSizes(): Int32Array {
    return this.sizes;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('the editor was disposed'));
    const next: Promise<T> = this.queue.then(task, task);
    this.queue = next.catch((): void => undefined);
    return next;
  }

  execute(command: EditorCommand): Promise<EditorState> {
    return this.serial((): Promise<EditorState> => this.apply(command));
  }

  /** Runs `command` now: only ever inside a serial task. */
  private async apply(command: EditorCommand): Promise<EditorState> {
    const { result } = await this.deps.client.request({ kind: 'apply', record: encodeCommand(command) });
    const composing: boolean = command.name === 'compositionStart' || command.name === 'compositionUpdate'
      ? true
      : command.name === 'compositionCommit' || command.name === 'compositionCancel' ? false : this.current.composing;
    return this.adopt(decodeResult(result), true, composing);
  }

  selectAt(page: number, x: number, y: number, how: SelectAt): Promise<EditorState> {
    return this.serial(async (): Promise<EditorState> => {
      const at: EditorPosition = decodePosition((await this.deps.client.request({ kind: 'hitTest', page, x, y })).position);
      switch (how.kind) {
        case 'caret': return this.apply({ name: 'setSelection', anchor: at, head: at });
        case 'extend': return this.apply({ name: 'setSelection', anchor: this.current.anchor, head: at });
        case 'drag': return this.apply({ name: 'setSelection', anchor: how.anchor, head: at });
        case 'word': return this.apply({ name: 'selectWord', at });
        case 'paragraph': return this.apply({ name: 'selectParagraph', at });
      }
    });
  }

  setViewport(pages: readonly number[]): Promise<EditorState> {
    const w: RecordWriter = new RecordWriter().u8(SET_VIEWPORT_OPCODE).uv(pages.length, 'viewport pages');
    for (const page of pages) w.uv(page, 'viewport page');
    const record: Uint8Array = w.finish();
    return this.serial(async (): Promise<EditorState> => {
      const { result } = await this.deps.client.request({ kind: 'apply', record });
      return this.adopt(decodeResult(result), true, this.current.composing);
    });
  }

  applyRemote(update: Uint8Array): Promise<RemoteApplied> {
    return this.serial(async (): Promise<RemoteApplied> => {
      const { result } = await this.deps.client.request({ kind: 'applyRemote', update: update.slice() });
      const decoded: EditorResult = decodeResult(result);
      if (decoded.remote === null) throw new Error('editor record: an applyRemote result has no remote section');
      return { state: await this.adopt(decoded, false, this.current.composing), remote: decoded.remote };
    });
  }

  private async adopt(r: EditorResult, local: boolean, composing: boolean): Promise<EditorState> {
    if (r.dirtyPages.length > 0) await this.deps.renderer.invalidate(r.dirtyPages);
    const countChanged: boolean = r.pageCount !== this.current.pageCount;
    if (countChanged) this.sizes = (await this.deps.client.request({ kind: 'pageSizes' })).pageSizes;
    const next: EditorState = {
      anchor: r.anchor, head: r.head, caret: r.caret, selectionRects: r.selectionRects, caretPage: r.caret?.page ?? null,
      pageCount: r.pageCount, composing, caretFormatting: r.formatting, created: r.created, selectionText: r.selectionText, story: r.story,
    };
    // A result that changes nothing (most viewport reports while scrolling) keeps the state and
    // tells no one: every listener (the ribbon, the overlays, presence) would redo its work for
    // the same values, once per scrolled frame.
    const moved: boolean = !sameValue(next, this.current);
    if (moved) this.current = next;
    if (local && r.update.length > 0) this.events.emit('change', { update: r.update, dirtyPages: r.dirtyPages });
    if (countChanged || r.dirtyPages.length > 0) this.events.emit('pages', { pageCount: r.pageCount, dirtyPages: r.dirtyPages });
    if (moved) this.events.emit('selection', this.current);
    return this.current;
  }

  hitTest(page: number, x: number, y: number): Promise<EditorPosition> {
    return this.serial(async () => decodePosition((await this.deps.client.request({ kind: 'hitTest', page, x, y })).position));
  }

  snapshot(): Promise<Uint8Array> {
    return this.serial(async () => (await this.deps.client.request({ kind: 'snapshot' })).snapshot);
  }

  awareness(): Promise<Uint8Array> {
    return this.serial(async () => (await this.deps.client.request({ kind: 'awareness' })).record);
  }

  peerView(record: Uint8Array): Promise<PeerView> {
    return this.serial(async () => decodePeerView((await this.deps.client.request({ kind: 'peerView', record: record.slice() })).record));
  }

  stateVector(): Promise<Uint8Array> {
    return this.serial(async (): Promise<Uint8Array> => (await this.deps.client.request({ kind: 'stateVector' })).stateVector);
  }

  encodeDiff(sv: Uint8Array): Promise<Uint8Array> {
    return this.serial(async (): Promise<Uint8Array> => (await this.deps.client.request({ kind: 'encodeDiff', sv: sv.slice() })).update);
  }

  encodeDiffChunked(remoteStateVector: Uint8Array | null, maxBytes: number): Promise<Uint8Array[]> {
    const sv: Uint8Array | null = remoteStateVector === null ? null : remoteStateVector.slice();
    return this.serial(async (): Promise<Uint8Array[]> => decodeChunks((await this.deps.client.request({ kind: 'encodeDiffChunked', sv, maxBytes })).record));
  }

  collectGarbage(known: readonly Uint8Array[]): Promise<Collected> {
    const w: RecordWriter = new RecordWriter().uv(known.length);
    for (const sv of known) w.bytes(sv);
    return this.serial(async () => decodeCollected((await this.deps.client.request({ kind: 'gc', known: w.finish() })).record));
  }

  selectionText(): Promise<string> {
    return this.serial(async (): Promise<string> => (await this.deps.client.request({ kind: 'selectionText' })).text);
  }

  exportAs(target: ExportTarget): Promise<ExportedFile> {
    return this.serial(async (): Promise<ExportedFile> => {
      const { bytes, reportJson } = await this.deps.client.request({ kind: 'exportAs', target });
      return { bytes, report: reportJson === null ? null : readExportReport(reportJson) };
    });
  }

  missingPatterns(): Promise<readonly string[]> {
    return this.serial(async (): Promise<readonly string[]> => (await this.deps.client.request({ kind: 'missingPatterns' })).tags);
  }

  styles(): Promise<DocumentStyle[]> {
    return this.serial(async (): Promise<DocumentStyle[]> => decodeStyles((await this.deps.client.request({ kind: 'styles' })).record));
  }

  addImage(bytes: Uint8Array, maxBytes: number): Promise<AddedImage> {
    return this.serial(async (): Promise<AddedImage> => decodeAddedImage((await this.deps.client.request({ kind: 'addImage', bytes: bytes.slice(), maxBytes })).record));
  }

  attachFocus(target: (() => void) | null): void {
    this.focusTarget = target;
  }

  focus(): void {
    if (this.focusTarget === null) throw new Error('the editor is not mounted, so it cannot take focus');
    this.focusTarget();
  }

  on<E extends keyof EditorEvents>(event: E, listener: (payload: EditorEvents[E]) => void): () => void {
    return this.events.on(event, listener);
  }

  dispose(): void {
    this.disposed = true;
    this.events.clear();
    this.peers.clear();
  }
}
