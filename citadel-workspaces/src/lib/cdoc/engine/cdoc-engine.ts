/**
 * The document engine the worker runs: cdoc-wasm with its faces and hyphenation patterns, one
 * open document, and its display list. No I/O of its own; the wasm modules and the asset
 * sources are handed in (EngineAssets, PdfWriter).
 *
 * R1 lays the document out once, at open, and keeps the whole display list: `paint(pages)`
 * answers from it, so scrolling never re-lays out. The reply holds every requested page and
 * may hold more (today, all of them); callers find pages by number through the page index.
 * An editable document is an EditorEngine (openEditor) instead, which paints only the pages
 * asked for; both share this engine's faces, and glyph outlines are asked for by face key, so
 * they answer for either.
 *
 * Patterns are fetched for the languages a document needs before it is laid out, as cdoc-wasm
 * asks (`hyphenation_patterns_needed`). An editor's fonts are sealed with a fixed pattern set,
 * and a seal lives as long as the page (cdoc-edit leaks it), so each set is sealed once.
 */
import { openDisplayList } from '../display-list/decoder';
import { DisplayListError } from '../display-list/byte-reader';
import type { DisplayList, FaceKey, PageEntry } from '../display-list/types';
import type { CdocWasm, EditorSealedFonts, ImageStore, RenderAssets } from './cdoc-wasm-api';
import { EditorEngine, type EditorOrigin } from './editor-engine';
import { patternSet, type EngineAssets, type LoadedFace } from './engine-assets';
import type { PdfWriter } from './pdf-writer';
import { isStaticSource, type StaticSource } from '../document-source';

/** What opening a static document produced. A file opens as a replica instead (openEditor). */
export interface OpenedDocument {
  readonly kind: 'opened';
  readonly pageCount: number;
  /** Width, height pairs in Pt100, in page order. */
  readonly pageSizes: Int32Array;
}

export interface GlyphPathBatch {
  readonly records: Uint8Array;
  /** `glyphIds.length + 1` offsets into `records`. */
  readonly offsets: Uint32Array;
}

interface OpenDoc {
  readonly bytes: Uint8Array;
  readonly list: DisplayList;
}

/**
 * RenderAssets takes the time its PDF output records. The display list records no time and
 * this artefact never writes a PDF, so the clock is a fixed, visibly meaningless instant.
 */
const DISPLAY_LIST_HAS_NO_CLOCK: string = '1970-01-01T00:00:00Z';

export class CdocEngine {
  private assets: Promise<RenderAssets> | null = null;
  /** The pattern tags registered on `assets` so far: registration only ever adds. */
  private readonly assetPatterns: Set<string> = new Set<string>();
  private readonly sealed: Map<string, Promise<EditorSealedFonts>> = new Map<string, Promise<EditorSealedFonts>>();
  /** Set once the faces are in: glyph outlines and metrics answer from it synchronously. */
  private ready: RenderAssets | null = null;
  private doc: OpenDoc | null = null;

  constructor(
    private readonly wasm: CdocWasm,
    private readonly files: EngineAssets,
    private readonly pdf: PdfWriter,
  ) {}

  /** The pattern tags a model document needs, as cdoc-wasm names them. */
  patternsNeeded(modelJson: string): readonly string[] {
    const tags: unknown = JSON.parse(this.wasm.hyphenation_patterns_needed(modelJson));
    if (!Array.isArray(tags) || !tags.every((t: unknown): t is string => typeof t === 'string')) throw new Error('hyphenation_patterns_needed did not answer a list of tags');
    return patternSet(tags);
  }

  private loadAssets(): Promise<RenderAssets> {
    this.assets ??= this.files.loadFaces().then((faces: readonly LoadedFace[]): RenderAssets => {
      const assets: RenderAssets = new this.wasm.RenderAssets(this.files.fontManifest.fallback, DISPLAY_LIST_HAS_NO_CLOCK);
      this.files.furnish(assets, faces, []);
      this.ready = assets;
      return assets;
    });
    this.assets.catch((): void => {
      this.assets = null;
    });
    return this.assets;
  }

  /** The read-only assets with `tags` registered too. */
  private async assetsWith(tags: readonly string[]): Promise<RenderAssets> {
    const assets: RenderAssets = await this.loadAssets();
    const missing: readonly string[] = tags.filter((t: string): boolean => !this.assetPatterns.has(t));
    for (const [tag, text] of await this.files.loadPatterns(missing)) {
      if (this.assetPatterns.has(tag)) continue;
      assets.addPatterns(tag, text);
      this.assetPatterns.add(tag);
    }
    return assets;
  }

  /** The faces and the patterns `tags` sealed for editing, once per pattern set. */
  private sealedFor(tags: readonly string[]): Promise<EditorSealedFonts> {
    const key: string = tags.join(',');
    let sealed: Promise<EditorSealedFonts> | undefined = this.sealed.get(key);
    if (sealed === undefined) {
      sealed = Promise.all([this.files.loadFaces(), this.files.loadPatterns(tags)]).then(([faces, patterns]): EditorSealedFonts => {
        const fonts: InstanceType<CdocWasm['EditorFonts']> = new this.wasm.EditorFonts(this.files.fontManifest.fallback);
        this.files.furnish(fonts, faces, patterns);
        return fonts.seal();
      });
      sealed.catch((): void => {
        this.sealed.delete(key);
      });
      this.sealed.set(key, sealed);
    }
    return sealed;
  }

  private close(): void {
    this.doc = null;
  }

  /**
   * Opens an editor as replica `client`; outlines for its pages come from this engine. Which
   * languages a snapshot or a file needs is only known once it is open, so it opens without
   * patterns first and, when it needs some, is opened again on fonts sealed with them.
   */
  async openEditor(client: bigint, origin: EditorOrigin): Promise<EditorEngine> {
    const [fonts] = await Promise.all([this.sealedFor([]), this.loadAssets()]);
    this.close();
    const probe: EditorEngine = EditorEngine.open(this.wasm, fonts, [], client, origin);
    let needed: readonly string[];
    try {
      needed = this.patternsNeeded(probe.modelJson());
    } catch (error: unknown) {
      probe.dispose();
      throw error;
    }
    if (needed.length === 0) return probe;
    probe.dispose();
    return EditorEngine.open(this.wasm, await this.sealedFor(needed), needed, client, origin);
  }

  /** `editor` as a PDF, through the PDF artefact, with the pattern set it was laid out with. */
  async writePdf(editor: EditorEngine, nowRfc3339: string): Promise<Uint8Array> {
    const images: ImageStore = new this.wasm.ImageStore();
    try {
      editor.drawnImages(images);
      return await this.pdf.write({ modelJson: editor.modelJson(), images, patterns: editor.patterns, nowRfc3339 });
    } finally {
      images.free();
    }
  }

  /** Docs' own JSON laid out once, read-only: it embeds no images, so none are registered. */
  async open(source: StaticSource): Promise<OpenedDocument> {
    // The worker's messages are not typed at run time: a file names the path it must take.
    if (!isStaticSource(source)) throw new Error(`a ${String((source as { kind: unknown }).kind)} document opens as a replica (editorOpen), not static`);
    const pmJson: string = source.kind === 'pm' ? source.pmJson : this.wasm.model_to_pm(source.modelJson);
    const patterns: readonly string[] = this.patternsNeeded(source.kind === 'model' ? source.modelJson : this.wasm.pm_to_model(pmJson));
    const assets: RenderAssets = await this.assetsWith(patterns);
    const bytes: Uint8Array = this.wasm.pm_to_display_list(pmJson, assets);
    const doc: OpenDoc = { bytes, list: openDisplayList(bytes) };
    this.close();
    this.doc = doc;
    const pageSizes: Int32Array = new Int32Array(doc.list.pages.length * 2);
    doc.list.pages.forEach((p: PageEntry, i: number) => {
      pageSizes[2 * i] = p.width;
      pageSizes[2 * i + 1] = p.height;
    });
    return { kind: 'opened', pageCount: doc.list.pages.length, pageSizes };
  }

  /** The open document's decoded list, for a painter in the same thread. */
  get list(): DisplayList {
    return this.current().list;
  }

  private current(): OpenDoc {
    if (this.doc === null) throw new DisplayListError('no document is open');
    return this.doc;
  }

  /** Display-list bytes holding at least `pages`, in a buffer of their own (transferable). */
  paint(pages: readonly number[]): Uint8Array {
    const list: DisplayList = this.list;
    for (const page of pages) {
      if (!Number.isInteger(page) || page < 0 || page >= list.pages.length) throw new DisplayListError(`page ${page} is not in the document`);
    }
    return this.current().bytes.slice();
  }

  private readyAssets(): RenderAssets {
    if (this.ready === null) throw new DisplayListError('no document is open, so no faces are loaded');
    return this.ready;
  }

  glyphPaths(face: FaceKey, glyphIds: Uint16Array): GlyphPathBatch {
    const assets: RenderAssets = this.readyAssets();
    const parts: Uint8Array[] = Array.from(glyphIds, (gid: number): Uint8Array => this.wasm.glyph_path(assets, face.family, face.bold, face.italic, gid));
    const offsets: Uint32Array = new Uint32Array(parts.length + 1);
    parts.forEach((p: Uint8Array, i: number) => {
      offsets[i + 1] = offsets[i] + p.length;
    });
    const records: Uint8Array = new Uint8Array(offsets[parts.length]);
    parts.forEach((p: Uint8Array, i: number) => records.set(p, offsets[i]));
    return { records, offsets };
  }

  faceMetrics(face: FaceKey): Uint8Array {
    return this.wasm.face_metrics(this.readyAssets(), face.family, face.bold, face.italic);
  }
}
