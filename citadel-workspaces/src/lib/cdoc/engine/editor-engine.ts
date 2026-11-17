/**
 * One editing session in the worker: cdoc-edit's EditorHandle over sealed faces. Records in,
 * records out (docs/edit-commands.md v4); this class decodes none of them, it only checks the
 * arguments the handle would otherwise read as something else. Every returned array is a copy
 * out of wasm memory, so it owns its buffer and can be transferred.
 */
import type { CdocWasm, EditorHandle, EditorSealedFonts, ImageStore } from './cdoc-wasm-api';
import type { PendingLimits } from './engine-limits';
import type { EditorOrigin } from '../editor/controller';
import type { DocumentExportTarget } from './editor-files';
import { openFromFile, writeFile, type OpenedFromFile, type WrittenFile } from './editor-files';

export type { EditorOrigin } from '../editor/controller';

function checkPage(page: number, pageCount: number): void {
  if (!Number.isInteger(page) || page < 0 || page >= pageCount) throw new Error(`page ${page} is not in the document (${pageCount} pages)`);
}

function checkPt(v: number, what: string): void {
  if (!Number.isInteger(v) || v < -0x8000_0000 || v > 0x7fff_ffff) throw new Error(`${what} ${v} is not an i32 Pt100`);
}

export class EditorEngine {
  /**
   * `patterns`: the hyphenation pattern set `fonts` were sealed with, which the PDF of this
   * replica is laid out with too. `importReportJson`: the import's `{"report", "problems",
   * "kind"}`, for a replica opened on a file.
   */
  private constructor(
    private readonly wasm: CdocWasm,
    private readonly handle: EditorHandle,
    readonly patterns: readonly string[],
    readonly importReportJson: string | null,
  ) {}

  static open(wasm: CdocWasm, fonts: EditorSealedFonts, patterns: readonly string[], client: bigint, origin: EditorOrigin): EditorEngine {
    if (client < 0n || client > 0xffff_ffff_ffff_ffffn) throw new Error(`client ${client} is not a u64`);
    switch (origin.kind) {
      case 'blank': return new EditorEngine(wasm, wasm.EditorHandle.blank(client, fonts), patterns, null);
      case 'snapshot': return new EditorEngine(wasm, wasm.EditorHandle.open(origin.snapshot, client, fonts), patterns, null);
      case 'bytes': {
        const opened: OpenedFromFile = openFromFile(wasm, fonts, client, origin.bytes, origin.format);
        return new EditorEngine(wasm, opened.handle, patterns, opened.reportJson);
      }
    }
  }

  /** The live replica as model JSON. */
  modelJson(): string {
    return this.handle.modelJson();
  }

  /** Adds the images the document draws to `images`. */
  drawnImages(images: ImageStore): void {
    this.handle.drawnImages(images);
  }

  get pageCount(): number {
    return this.handle.pageCount();
  }

  request(record: Uint8Array): Uint8Array {
    return this.handle.request(record);
  }

  applyRemote(update: Uint8Array, limits: PendingLimits): Uint8Array {
    return this.handle.applyRemote(update, limits.maxOps, limits.maxBytes);
  }

  /** The display list of exactly `pages`. */
  paint(pages: readonly number[]): Uint8Array {
    const count: number = this.pageCount;
    for (const page of pages) checkPage(page, count);
    return this.handle.paint(Uint32Array.from(pages));
  }

  hitTest(page: number, x: number, y: number): Uint8Array {
    checkPage(page, this.pageCount);
    checkPt(x, 'x');
    checkPt(y, 'y');
    return this.handle.hitTest(page, x, y);
  }

  /** Width, height pairs in Pt100, in page order. */
  pageSizes(): Int32Array {
    const count: number = this.pageCount;
    const sizes: Int32Array = new Int32Array(count * 2);
    for (let page: number = 0; page < count; page++) {
      const size: Int32Array | undefined = this.handle.pageSize(page);
      if (size === undefined || size.length !== 2) throw new Error(`page ${page} has no size`);
      sizes.set(size, page * 2);
    }
    return sizes;
  }

  snapshot(): Uint8Array {
    return this.handle.snapshot();
  }

  awareness(): Uint8Array {
    return this.handle.awareness();
  }

  peerView(record: Uint8Array): Uint8Array {
    return this.handle.peerView(record);
  }

  stateVector(): Uint8Array {
    return this.handle.stateVector();
  }

  encodeDiff(sv: Uint8Array): Uint8Array {
    return this.handle.encodeDiff(sv);
  }

  /** cdoc-crdt's Doc::encode_diff_chunked: the "CDK" record of updates of at most `maxBytes` each. */
  encodeDiffChunked(sv: Uint8Array | null, maxBytes: number): Uint8Array {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 0xffff_ffff) throw new Error(`maxBytes ${maxBytes} is not a positive u32`);
    return this.handle.encodeDiffChunked(sv, maxBytes);
  }

  /** cdoc-crdt's Doc::gc over the known-peers record; returns the "CDG" collected record. */
  collectGarbage(known: Uint8Array): Uint8Array {
    return this.handle.gc(known);
  }

  /** Holds an image of at most `maxBytes`; returns the "CDI" added-image record. */
  addImage(bytes: Uint8Array, maxBytes: number): Uint8Array {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 0xffff_ffff) throw new Error(`maxBytes ${maxBytes} is not a u32`);
    return this.handle.addImage(bytes, maxBytes);
  }

  /** The selection's plain text, uncapped: Copy past the result record's 64 KiB. */
  selectionText(): string {
    return this.handle.selectionText();
  }

  /** The "CDS" style sheet. */
  styles(): Uint8Array {
    return this.handle.styles();
  }

  /** The "CDB" record of a held image; an unknown id fails by name. */
  image(contentId: string): Uint8Array {
    return this.handle.image(contentId);
  }

  /** Every format but PDF, which the editor artefact cannot write (CdocEngine.writePdf). */
  exportAs(target: DocumentExportTarget): WrittenFile {
    return writeFile(this.wasm, this.handle, target);
  }

  dispose(): void {
    this.handle.free();
  }
}
