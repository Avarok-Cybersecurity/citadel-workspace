/**
 * The editor's commands: every EditorCommand and its request opcode, exactly citadel-docs
 * docs/edit-commands.md's table. EditorCommand is the single source the controller's
 * `commands` and `execute` are derived from.
 */
import type { CommentValue, PageSetupPatch, ParagraphPatch, Pt100, RunPatch } from './model-values';

/**
 * A CRDT position (`client:uv clock:uv`), opaque: copied out of a result or a hit test and
 * back into a request, never read. Survives local and remote edits.
 */
export type EditorPosition = Uint8Array & { readonly __editorPosition: unique symbol };

/** A rectangle in page space, Pt100, top-left origin, y down. */
export interface PtRect {
  readonly x: Pt100;
  readonly y: Pt100;
  readonly width: Pt100;
  readonly height: Pt100;
}

/** A rectangle on a zero-based page. */
export interface PageRect {
  readonly page: number;
  readonly rect: PtRect;
}

export type DeleteUnit = 'char' | 'word';
export type BreakKind = 'line' | 'page' | 'column';
export type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'subscript' | 'superscript';
export type CaretGranularity = 'char' | 'word' | 'lineBoundary' | 'line' | 'paragraph' | 'document';
/** Word's built-in list templates (SetNumberingKind). */
export type ListKind = 'bullet' | 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';
/** A section's header or footer. */
export type Furniture = 'header' | 'footer';
/** Which of a section's headers (or footers): the default, the first page's, the even pages'. */
export type HeaderFooterKind = 'default' | 'firstPage' | 'evenPages';

/**
 * The story the selection is in (result record v6): the body, a section's header or footer,
 * or a footnote's body. A selection never spans two.
 */
export type Story =
  | { readonly kind: 'body' }
  | { readonly kind: Furniture; readonly section: number; readonly which: HeaderFooterKind }
  | { readonly kind: 'footnote'; readonly id: number };

export type EditorCommand =
  | { readonly name: 'insertText'; readonly text: string }
  | { readonly name: 'deleteBackward'; readonly unit: DeleteUnit }
  | { readonly name: 'deleteForward'; readonly unit: DeleteUnit }
  | { readonly name: 'splitParagraph' }
  | { readonly name: 'insertBreak'; readonly kind: BreakKind }
  | { readonly name: 'insertTab' }
  | { readonly name: 'toggleMark'; readonly mark: Mark }
  /** Clear Formatting is `setRunProperty({ patch: CLEAR_FORMATTING })`. */
  | { readonly name: 'setRunProperty'; readonly patch: RunPatch }
  | { readonly name: 'setParagraphProperty'; readonly patch: ParagraphPatch }
  | { readonly name: 'setParagraphStyle'; readonly style: string }
  | { readonly name: 'setNumbering'; readonly numId: number; readonly level: number }
  | { readonly name: 'clearNumbering' }
  /** A built-in list at `level` (0..=8); a new numbering instance comes back in `created`. */
  | { readonly name: 'setNumberingKind'; readonly kind: ListKind; readonly level: number }
  | { readonly name: 'indent' }
  | { readonly name: 'outdent' }
  /** Page setup of every section from the anchor's to the head's. */
  | { readonly name: 'setSectionProperty'; readonly patch: PageSetupPatch }
  | { readonly name: 'insertTable'; readonly rows: number; readonly cols: number }
  | { readonly name: 'insertRowAbove' }
  | { readonly name: 'insertRowBelow' }
  | { readonly name: 'insertColumnLeft' }
  | { readonly name: 'insertColumnRight' }
  | { readonly name: 'deleteRow' }
  | { readonly name: 'deleteColumn' }
  | { readonly name: 'deleteTable' }
  | { readonly name: 'mergeCells' }
  | { readonly name: 'insertImage'; readonly contentId: string; readonly width: Pt100; readonly height: Pt100 }
  | { readonly name: 'insertFootnote'; readonly id: number }
  /** A footnote under an id the editor picks, reported in `created`. */
  | { readonly name: 'insertNewFootnote' }
  /** An image the editor holds at its own size, scaled down to fit one column, never up. */
  | { readonly name: 'insertImageFitted'; readonly contentId: string }
  | { readonly name: 'insertLink'; readonly href: string }
  | { readonly name: 'removeLink' }
  | { readonly name: 'insertComment'; readonly comment: CommentValue }
  | { readonly name: 'replace'; readonly from: EditorPosition; readonly to: EditorPosition; readonly text: string }
  /** The story the caret is in: the body, or the header, footer or footnote being edited. */
  | { readonly name: 'selectAll' }
  /** The caret at the start of a section's header or footer, adding an empty one if it has none. */
  | { readonly name: 'editHeaderFooter'; readonly furniture: Furniture; readonly section: number; readonly which: HeaderFooterKind }
  /** The caret at the start of a footnote's body (after insertNewFootnote, its `created` id). */
  | { readonly name: 'goToFootnote'; readonly id: number }
  /** Leaves a header, footer or footnote for the body; in the body it does nothing. */
  | { readonly name: 'returnToBody' }
  | { readonly name: 'setSelection'; readonly anchor: EditorPosition; readonly head: EditorPosition }
  /** Deletes the selection as one undo step (copy its text first); a caret fails. */
  | { readonly name: 'cut' }
  | { readonly name: 'undo' }
  | { readonly name: 'redo' }
  /** Ends the current undo step: on blur, after a typing pause, before a paste. */
  | { readonly name: 'breakUndoGroup' }
  | { readonly name: 'moveCaret'; readonly granularity: CaretGranularity; readonly forward: boolean; readonly extend: boolean }
  | { readonly name: 'selectWord'; readonly at: EditorPosition }
  | { readonly name: 'selectParagraph'; readonly at: EditorPosition }
  | { readonly name: 'compositionStart' }
  /** `caret` counts characters into `text`. */
  | { readonly name: 'compositionUpdate'; readonly text: string; readonly caret: number }
  | { readonly name: 'compositionCommit' }
  | { readonly name: 'compositionCancel' };

export type EditorCommandName = EditorCommand['name'];
export type CommandOf<N extends EditorCommandName> = Extract<EditorCommand, { name: N }>;

/** Each command's request opcode, exactly docs/edit-commands.md's table. */
export const COMMAND_OPCODES: { readonly [N in EditorCommandName]: number } = {
  insertText: 0x01,
  deleteBackward: 0x02,
  deleteForward: 0x03,
  splitParagraph: 0x04,
  insertBreak: 0x05,
  insertTab: 0x06,
  toggleMark: 0x07,
  setRunProperty: 0x08,
  setParagraphProperty: 0x09,
  setParagraphStyle: 0x0a,
  setNumbering: 0x0b,
  clearNumbering: 0x0c,
  setNumberingKind: 0x19,
  indent: 0x0d,
  outdent: 0x0e,
  setSectionProperty: 0x0f,
  insertTable: 0x10,
  insertRowAbove: 0x11,
  insertRowBelow: 0x12,
  insertColumnLeft: 0x13,
  insertColumnRight: 0x14,
  deleteRow: 0x15,
  deleteColumn: 0x16,
  deleteTable: 0x17,
  mergeCells: 0x18,
  insertImage: 0x20,
  insertFootnote: 0x21,
  insertNewFootnote: 0x25,
  insertImageFitted: 0x26,
  insertLink: 0x22,
  removeLink: 0x23,
  insertComment: 0x24,
  replace: 0x30,
  selectAll: 0x31,
  setSelection: 0x32,
  cut: 0x33,
  editHeaderFooter: 0x34,
  goToFootnote: 0x35,
  returnToBody: 0x36,
  undo: 0x40,
  redo: 0x41,
  breakUndoGroup: 0x42,
  moveCaret: 0x43,
  selectWord: 0x44,
  selectParagraph: 0x45,
  compositionStart: 0x50,
  compositionUpdate: 0x51,
  compositionCommit: 0x52,
  compositionCancel: 0x53,
};

/**
 * SetViewport (0x60): the pages on screen, so results carry selection rectangles for those
 * and the repainted pages only. Not a document command (no undo step), so not an EditorCommand:
 * the page view sends it, never a ribbon.
 */
export const SET_VIEWPORT_OPCODE: number = 0x60;
