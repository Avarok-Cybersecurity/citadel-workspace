/**
 * What the rest of the UI holds to drive a Citadel Docs editor: the ribbons (Home, Insert,
 * Layout) call commands by name, read the selection and caret, and listen for changes; the
 * collaboration wiring relays updates and awareness. The editor itself (cdoc-edit's
 * EditorHandle) runs in the cdoc worker; every command becomes one request record of
 * citadel-docs docs/edit-commands.md (version 6), whose opcode COMMAND_OPCODES names.
 *
 * EditorCommand is the single source: `commands` and `execute` are both derived from it, so a
 * command added there is a type error until it has an opcode and both surfaces carry it.
 */
import type { Pt100 } from './model-values';
import type { CommandOf, EditorCommand, EditorCommandName, EditorPosition, PageRect } from './editor-commands';
import type { CaretFormatting } from './caret-formatting';
import type { ExportedFile, ExportTarget, ImportFormat, ImportReport } from './file-formats';
import type { PeerOverlay } from './peer-overlay';
import type { Created, RemoteReport, SelectionText } from './wire/decode-result';
import type { Story } from './editor-commands';
import type { DocumentStyle } from './wire/decode-v4-records';
import type { Collected } from './wire/decode-records';

export type { DocumentStyle } from './wire/decode-v4-records';

export type { Created, MissingUnit, RemoteReport, SelectionText } from './wire/decode-result';

export * from './editor-commands';

export type { CaretFormatting } from './caret-formatting';

export interface EditorState {
  readonly anchor: EditorPosition;
  readonly head: EditorPosition;
  /** Zero width, line height; null when the result record reports no caret. */
  readonly caret: PageRect | null;
  /** One rect per selected line, empty for a collapsed selection. */
  readonly selectionRects: readonly PageRect[];
  /** The zero-based page the caret is on, or null with no caret. */
  readonly caretPage: number | null;
  readonly pageCount: number;
  /** An IME composition is open; its provisional text is drawn at the caret. */
  readonly composing: boolean;
  readonly caretFormatting: CaretFormatting;
  /** What the last command made under ids the editor picked (a footnote, a list instance). */
  readonly created: readonly Created[];
  /** The selection's plain text, for Copy and Cut; empty for a caret. */
  readonly selectionText: SelectionText;
  /**
   * The story the selection is in. A header or footer shown on many pages is one story: its
   * caret and selection are drawn on the first of those pages only (cdoc-edit).
   */
  readonly story: Story;
}

/** A peer's update applied: the state after it, and what it left waiting (null: nothing). */
export interface RemoteApplied {
  readonly state: EditorState;
  readonly remote: RemoteReport;
}

/** A peer's caret and selection mapped onto this replica's pages. */
export interface PeerView {
  readonly client: bigint;
  readonly caret: PageRect | null;
  readonly selectionRects: readonly PageRect[];
}

export interface EditorEvents {
  /** A local command changed the document; `update` is the CRDT update to relay to peers. */
  change: { readonly update: Uint8Array; readonly dirtyPages: readonly number[] };
  /** Selection, caret or composition moved (after any command, local or remote). */
  selection: EditorState;
  /** Pages were repainted or the page count changed (local or remote). */
  pages: { readonly pageCount: number; readonly dirtyPages: readonly number[] };
}

export type EditorEventName = keyof EditorEvents;

type ArgsOf<N extends EditorCommandName> = Omit<CommandOf<N>, 'name'>;

/** One method per command, derived from EditorCommand: `commands.toggleMark({ mark: 'bold' })`. */
export type EditorCommands = {
  readonly [N in EditorCommandName]: keyof ArgsOf<N> extends never
    ? () => Promise<EditorState>
    : (args: ArgsOf<N>) => Promise<EditorState>;
};

/** What a replica opens from: a new blank document, a CRDT snapshot, or a file's bytes. */
/** What a press at a point selects (EditorController.selectAt). */
export type SelectAt =
  /** A caret at the point. */
  | { readonly kind: 'caret' }
  /** From the selection's anchor to the point: Shift+click. */
  | { readonly kind: 'extend' }
  /** From `anchor` to the point: a drag from where it began. */
  | { readonly kind: 'drag'; readonly anchor: EditorPosition }
  | { readonly kind: 'word' }
  | { readonly kind: 'paragraph' };

export type EditorOrigin =
  | { readonly kind: 'blank' }
  | { readonly kind: 'snapshot'; readonly snapshot: Uint8Array }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly format: ImportFormat };

/** A stored image (the "CDI" record): its content id is `sha256-` and the file's hex digest. */
export interface AddedImage {
  readonly contentId: string;
  readonly kind: 'png' | 'jpeg';
  /** Pixels; the display size is the caller's, sent with insertImage in Pt100. */
  readonly width: number;
  readonly height: number;
}

/**
 * The only way to open a replica. Each call is a NEW replica with its own random 64-bit CRDT
 * client id (two tabs of one account are two replicas), never a default and never the CID.
 */
export type EditorOpener = (from: EditorOrigin) => Promise<EditorController>;

export interface EditorController {
  readonly state: EditorState;
  readonly commands: EditorCommands;
  /** Other people's carets and selections over the pages (peer-overlay.ts). */
  readonly peers: PeerOverlay;
  /**
   * Runs one command; resolves with the state after it. Rejects (and changes nothing) when the
   * command does not apply where the selection is, e.g. mergeCells outside a table.
   */
  execute(command: EditorCommand): Promise<EditorState>;
  /** The position nearest `(x, y)` on zero-based `page`, in Pt100 page space. */
  hitTest(page: number, x: Pt100, y: Pt100): Promise<EditorPosition>;
  /**
   * Hit-tests `(x, y)` on `page` and selects there, as one step of the command queue: a command
   * queued after it (a keystroke after the click) always applies to the selection it made, never
   * to one computed against the document before.
   */
  selectAt(page: number, x: Pt100, y: Pt100, how: SelectAt): Promise<EditorState>;
  /**
   * Applies a peer's CRDT update; emits `pages` and `selection`, never `change`. Operations that
   * wait for a unit this replica lacks are buffered within PENDING_LIMITS; `remote` says what
   * waits and how many the limits dropped, either of which asks for a diff against stateVector().
   */
  applyRemote(update: Uint8Array): Promise<RemoteApplied>;
  /** The full CRDT snapshot, to persist or to seed a joining peer. */
  snapshot(): Promise<Uint8Array>;
  /** This replica's awareness record, to relay as is. */
  awareness(): Promise<Uint8Array>;
  /** A peer's awareness record as rectangles on this replica's pages. */
  peerView(record: Uint8Array): Promise<PeerView>;
  /** This replica's state vector, for a peer to compute what this replica lacks. */
  stateVector(): Promise<Uint8Array>;
  /** The update a peer at state vector `sv` lacks, to send it. */
  encodeDiff(sv: Uint8Array): Promise<Uint8Array>;
  /** The same diff as valid updates of at most `maxBytes` each, applied in order; null starts
   * from the empty state vector (the whole replica, e.g. an import into an empty log). */
  encodeDiffChunked(remoteStateVector: Uint8Array | null, maxBytes: number): Promise<Uint8Array[]>;
  /**
   * Collects this replica's tombstones (cdoc-crdt Doc::gc) that every peer in `known` (each
   * peer's acknowledged stateVector) has seen; resolves with what was removed. Valid only when
   * every peer holds everything this replica holds; the collaboration session decides when.
   * The undo history ends.
   */
  collectGarbage(known: readonly Uint8Array[]): Promise<Collected>;
  /**
   * Holds an image file (PNG or JPEG, read from its signature) of at most `maxBytes` bytes, and
   * resolves with its content id and pixel size; `insertImage` then places it. Store the bytes
   * in the workspace's content store under that id before relaying the insertImage update.
   */
  addImage(bytes: Uint8Array, maxBytes: number): Promise<AddedImage>;
  /** The selection as plain text, empty when it is collapsed: what copy and cut put on the clipboard. */
  selectionText(): Promise<string>;
  /** The document's style sheet, each style as it resolves, for the styles gallery. */
  styles(): Promise<DocumentStyle[]>;
  /** The live document as a file. */
  exportAs(target: ExportTarget): Promise<ExportedFile>;
  /**
   * Hyphenation pattern tags (`de-1996`) the document now needs that this replica was opened
   * without: an edit brought in a language, and its hyphenation applies after reopening.
   */
  missingPatterns(): Promise<readonly string[]>;
  /** What the import lost, for a replica opened from file bytes; null otherwise. */
  readonly importReport: ImportReport | null;
  /** Returns keyboard focus to the editor, e.g. after a ribbon button took it. */
  focus(): void;
  on<E extends EditorEventName>(event: E, listener: (payload: EditorEvents[E]) => void): () => void;
  dispose(): void;
}
