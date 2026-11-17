/**
 * The editor's request kinds in the cdoc worker protocol (protocol.ts), one per EditorHandle
 * call. Records are citadel-docs docs/edit-commands.md v1 bytes, each a Uint8Array owning its
 * buffer and moved as a Transferable; the worker never decodes a request record and the page
 * decodes every result. Part of CdocRequestBody and CdocResults (protocol.ts).
 */
import type { EditorOrigin } from '../editor/controller';
import type { ExportTarget } from '../editor/file-formats';

export type EditorRequestBody =
  /** Opens the editor as replica `client` from a blank document, a CRDT snapshot or file bytes. */
  | { readonly kind: 'editorOpen'; readonly client: bigint; readonly from: EditorOrigin }
  /** One request record (opcode + fields). */
  | { readonly kind: 'apply'; readonly record: Uint8Array }
  | { readonly kind: 'applyRemote'; readonly update: Uint8Array }
  /** Pt100 page space, zero-based page. */
  | { readonly kind: 'hitTest'; readonly page: number; readonly x: number; readonly y: number }
  | { readonly kind: 'snapshot' }
  | { readonly kind: 'awareness' }
  | { readonly kind: 'peerView'; readonly record: Uint8Array }
  /** Every page's size, after an edit changed the page count. */
  | { readonly kind: 'pageSizes' }
  | { readonly kind: 'stateVector' }
  | { readonly kind: 'encodeDiff'; readonly sv: Uint8Array }
  /** `sv` null: from the empty state vector (the replica's whole state). */
  | { readonly kind: 'encodeDiffChunked'; readonly sv: Uint8Array | null; readonly maxBytes: number }
  /** Collects tombstones; `known` is the known-peers record (count, then each state vector). */
  | { readonly kind: 'gc'; readonly known: Uint8Array }
  /** Holds an image file of at most `maxBytes` bytes. */
  | { readonly kind: 'addImage'; readonly bytes: Uint8Array; readonly maxBytes: number }
  | { readonly kind: 'selectionText' }
  | { readonly kind: 'styles' }
  | { readonly kind: 'image'; readonly contentId: string }
  | { readonly kind: 'exportAs'; readonly target: ExportTarget }
  /** The languages the document now needs patterns for that the replica was not opened with. */
  | { readonly kind: 'missingPatterns' }
  /** Drops the worker painter's copy of `pages` (an edit changed them) before they repaint. */
  | { readonly kind: 'invalidatePages'; readonly pages: readonly number[] };

export interface EditorResults {
  /**
   * EditorHandle.open returns no result record, so the opening state is its own awareness
   * ("CDA": anchor, head) and that record's peer view ("CDP": caret, selection rects).
   */
  editorOpen: { readonly pageSizes: Int32Array; readonly awareness: Uint8Array; readonly view: Uint8Array; readonly importReportJson: string | null };
  /** The "CDE" result record. */
  apply: { readonly result: Uint8Array };
  applyRemote: { readonly result: Uint8Array };
  /** A position record. */
  hitTest: { readonly position: Uint8Array };
  snapshot: { readonly snapshot: Uint8Array };
  /** A "CDA" awareness record. */
  awareness: { readonly record: Uint8Array };
  /** A "CDP" peer-view record. */
  peerView: { readonly record: Uint8Array };
  /** Width, height pairs in Pt100, in page order. */
  pageSizes: { readonly pageSizes: Int32Array };
  invalidatePages: { readonly pages: readonly number[] };
  stateVector: { readonly stateVector: Uint8Array };
  encodeDiff: { readonly update: Uint8Array };
  /** Updates to apply in order, each at most the request's maxBytes. */
  /** The "CDK" chunks record. */
  encodeDiffChunked: { readonly record: Uint8Array };
  /** A "CDG" collected record. */
  gc: { readonly record: Uint8Array };
  /** A "CDI" added-image record. */
  addImage: { readonly record: Uint8Array };
  selectionText: { readonly text: string };
  /** A "CDS" style sheet. */
  styles: { readonly record: Uint8Array };
  /** A "CDB" image record. */
  image: { readonly record: Uint8Array };
  /**
   * The file and its `{"losses"}` report as the engine wrote it. Null for a PDF: the PDF
   * writer reports no losses (pm_to_pdf returns only bytes).
   */
  exportAs: { readonly bytes: Uint8Array; readonly reportJson: string | null };
  /** Pattern tags, as cdoc-wasm names them (`de-1996`). */
  missingPatterns: { readonly tags: readonly string[] };
}

export type EditorKind = EditorRequestBody['kind'];

export const EDITOR_KINDS: readonly EditorKind[] = ['editorOpen', 'apply', 'applyRemote', 'hitTest', 'snapshot', 'awareness', 'peerView', 'pageSizes', 'invalidatePages', 'stateVector', 'encodeDiff', 'encodeDiffChunked', 'gc', 'addImage', 'selectionText', 'styles', 'image', 'exportAs', 'missingPatterns'];
