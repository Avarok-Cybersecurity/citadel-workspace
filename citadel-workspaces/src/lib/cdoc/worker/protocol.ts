/**
 * The messages between the page and the Citadel Docs worker: one discriminated union of
 * requests, each answered once under its request id. Every byte payload is a typed array over
 * a buffer of its own and travels as a Transferable, never as JSON: a 100-page display list is
 * moved, not copied or parsed.
 *
 * The editor's kinds (cdoc-edit's EditorHandle) are declared in editor-protocol.ts and joined
 * in here. Glyph outlines and metrics are asked for by face key, not by a face index of one
 * display list, because an editor's partial lists each number their faces afresh.
 */
import type { GlyphPathBatch, OpenedDocument } from '../engine/cdoc-engine';
import type { StaticSource } from '../document-source';
import type { PaintOutcome } from '../paint/page-rasterizer';
import type { FaceKey } from '../display-list/types';
import { EDITOR_KINDS, type EditorRequestBody, type EditorResults } from './editor-protocol';

export type CdocRequestBody =
  /** Docs' own JSON, laid out read-only; a file opens as a replica (editorOpen), and exports from it (exportAs). */
  | { readonly kind: 'open'; readonly source: StaticSource }
  | { readonly kind: 'paint'; readonly pages: readonly number[] }
  | { readonly kind: 'glyphPaths'; readonly face: FaceKey; readonly glyphIds: Uint16Array }
  | { readonly kind: 'faceMetrics'; readonly face: FaceKey }
  /** Hands the worker a page canvas (transferred); `slot` names it in later requests. */
  | { readonly kind: 'attachCanvas'; readonly slot: number; readonly canvas: OffscreenCanvas }
  | { readonly kind: 'paintCanvas'; readonly slot: number; readonly pageNumber: number; readonly zoom: number; readonly dpr: number }
  | { readonly kind: 'detachCanvas'; readonly slot: number }
  | EditorRequestBody;

export interface CdocResults extends EditorResults {
  open: OpenedDocument;
  paint: { readonly displayList: Uint8Array };
  glyphPaths: GlyphPathBatch;
  faceMetrics: { readonly metrics: Uint8Array };
  attachCanvas: { readonly slot: number };
  paintCanvas: PaintOutcome;
  detachCanvas: { readonly slot: number };
}

export type CdocKind = CdocRequestBody['kind'];
export type RequestOf<K extends CdocKind> = Extract<CdocRequestBody, { kind: K }>;
export type CdocRequest = CdocRequestBody & { readonly id: number };

export type CdocResponse =
  | { readonly id: number; readonly ok: true; readonly result: CdocResults[CdocKind] }
  | { readonly id: number; readonly ok: false; readonly error: string };

const KINDS: ReadonlySet<string> = new Set<CdocKind>(['open', 'paint', 'glyphPaths', 'faceMetrics', 'attachCanvas', 'paintCanvas', 'detachCanvas', ...EDITOR_KINDS]);

export function isCdocRequest(value: unknown): value is CdocRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v: { id?: unknown; kind?: unknown } = value as { id?: unknown; kind?: unknown };
  return typeof v.id === 'number' && typeof v.kind === 'string' && KINDS.has(v.kind);
}

export function isCdocResponse(value: unknown): value is CdocResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v: { id?: unknown; ok?: unknown } = value as { id?: unknown; ok?: unknown };
  return typeof v.id === 'number' && typeof v.ok === 'boolean';
}

/**
 * The buffers (and canvases) a message carries, for postMessage's transfer list. A typed array
 * that is a window onto a larger buffer is refused: transferring it would detach every other
 * view of that buffer, which is never what the sender meant.
 */
export function transferablesOf(message: object): Transferable[] {
  const out: Transferable[] = [];
  for (const value of Object.values(message)) {
    if (ArrayBuffer.isView(value)) {
      if (value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength) {
        throw new Error('a protocol payload must own its whole buffer; copy it with .slice() first');
      }
      if (!out.includes(value.buffer as ArrayBuffer)) out.push(value.buffer as ArrayBuffer);
    } else if (typeof OffscreenCanvas === 'function' && value instanceof OffscreenCanvas) {
      out.push(value);
    } else if (typeof value === 'object' && value !== null) {
      out.push(...transferablesOf(value).filter((t: Transferable) => !out.includes(t)));
    }
  }
  return out;
}
