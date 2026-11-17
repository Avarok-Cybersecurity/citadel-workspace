/**
 * Everything one painter instance keeps between paints: the display list, the pages decoded
 * from it, the glyph outlines and the atlas. The main-thread renderer and the worker's
 * OffscreenCanvas renderer both own one; they differ only in where outlines come from (a
 * worker round trip, or cdoc-wasm in the same thread), which is why `missingGlyphs` and
 * `addOutlines` are separate from `paint`, which never waits. Images likewise: `missingImages`
 * names the ids a page draws that are not decoded yet, the renderer resolves them, and the
 * cache keeps them across repaints and lists, so each id is decoded once.
 */
import { slotOfPage } from '../display-list/decoder';
import { decodePage } from '../display-list/page-ops';
import type { DisplayList, Face, FaceKey, PageOps } from '../display-list/types';
import { DisplayListError } from '../display-list/byte-reader';
import type { CanvasPort, PaintTarget } from './canvas-port';
import { GlyphAtlas, type AtlasConfig, type AtlasStats } from './glyph-atlas';
import { OutlineStore } from './glyph-outlines';
import { paintPage, type ImagePlaceholderStyle, type LinkArea } from './page-painter';
import { ImageCache, type PaintableImage } from './image-cache';
import { pageSizePx, type DeviceScale } from './units';

export interface RasterizerOptions {
  readonly atlas: AtlasConfig;
  readonly paper: string;
  readonly placeholder: ImagePlaceholderStyle;
  /** Decoded pixels the image cache may hold, in bytes. */
  readonly imageCacheBytes: number;
}

export interface PaintOutcome {
  readonly links: readonly LinkArea[];
  readonly atlas: AtlasStats;
}

/** A page's list and that list's faces, renumbered to this painter's stable face ids. */
interface HeldPage {
  readonly list: DisplayList;
  readonly faces: readonly Face[];
}

export class PageRasterizer {
  /**
   * Which list holds each page. A partial list (an editor repaint) replaces only its own
   * pages, and its face ids and glyph tables are its own, so every page keeps the list it
   * came from and faces are renumbered by key: outlines and atlas cells survive repaints.
   */
  private readonly held: Map<number, HeldPage> = new Map<number, HeldPage>();
  private readonly pages: Map<number, PageOps> = new Map<number, PageOps>();
  private readonly faceIds: Map<string, number> = new Map<string, number>();
  private readonly faceKeys: FaceKey[] = [];
  private readonly outlines: OutlineStore;
  private readonly atlas: GlyphAtlas;
  private readonly images: ImageCache;

  constructor(port: CanvasPort, private readonly options: RasterizerOptions) {
    this.outlines = new OutlineStore(port);
    this.atlas = new GlyphAtlas(port, options.atlas);
    this.images = new ImageCache(options.imageCacheBytes);
  }

  /** The image ids `pageNumber` draws that this painter has not resolved yet. */
  missingImages(pageNumber: number): string[] {
    const ids: Set<string> = new Set<string>();
    for (const op of this.page(pageNumber).ops) {
      if (op.kind === 'image' && !this.images.has(op.contentId)) ids.add(op.contentId);
    }
    return [...ids];
  }

  addImage(contentId: string, image: PaintableImage): void {
    this.images.set(contentId, image);
  }

  /** Frees every decoded image (the document closed). */
  dispose(): void {
    this.images.clear();
  }

  private stableId(face: Face): number {
    const key: string = `${face.bold ? 'b' : '-'}${face.italic ? 'i' : '-'}${face.family}`;
    let id: number | undefined = this.faceIds.get(key);
    if (id === undefined) {
      id = this.faceKeys.length;
      this.faceIds.set(key, id);
      this.faceKeys.push({ family: face.family, bold: face.bold, italic: face.italic });
    }
    return id;
  }

  /** Replaces the pages this list holds (a partial list replaces only its own pages). */
  setList(list: DisplayList): void {
    const faces: Face[] = list.faces.map((f: Face): Face => ({ ...f, faceId: this.stableId(f) }));
    for (const entry of list.pages) {
      this.held.set(entry.number, { list, faces });
      this.pages.delete(entry.number);
    }
  }

  /** Forgets `pages` (an edit changed them): the next paint of each needs a fresh list. */
  invalidate(pages: readonly number[]): void {
    for (const page of pages) {
      this.held.delete(page);
      this.pages.delete(page);
    }
  }

  holds(pageNumber: number): boolean {
    return this.held.has(pageNumber);
  }

  /** The face a stable id (from missingGlyphs) names, to ask cdoc for its outlines. */
  faceKey(faceId: number): FaceKey {
    const key: FaceKey | undefined = this.faceKeys[faceId];
    if (key === undefined) throw new DisplayListError(`face ${faceId} is not known to this painter`);
    return key;
  }

  private heldPage(pageNumber: number): HeldPage {
    const held: HeldPage | undefined = this.held.get(pageNumber);
    if (held === undefined) throw new DisplayListError(`page ${pageNumber} is not in the display list`);
    return held;
  }

  private page(pageNumber: number): PageOps {
    let page: PageOps | undefined = this.pages.get(pageNumber);
    if (page === undefined) {
      const list: DisplayList = this.heldPage(pageNumber).list;
      const slot: number | null = slotOfPage(list, pageNumber);
      if (slot === null) throw new DisplayListError(`page ${pageNumber} is not in the display list`);
      page = decodePage(list, slot);
      this.pages.set(pageNumber, page);
    }
    return page;
  }

  /** The glyphs `pageNumber` sets whose outlines this painter does not hold yet, by face. */
  missingGlyphs(pageNumber: number): Map<number, Uint16Array> {
    const wanted: Map<number, Set<number>> = new Map<number, Set<number>>();
    const faces: readonly Face[] = this.heldPage(pageNumber).faces;
    for (const op of this.page(pageNumber).ops) {
      if (op.kind !== 'glyphRun') continue;
      const faceId: number = faces[op.head.faceId].faceId;
      for (const glyphId of op.glyphIds) {
        if (this.outlines.has(faceId, glyphId)) continue;
        let set: Set<number> | undefined = wanted.get(faceId);
        if (set === undefined) wanted.set(faceId, (set = new Set<number>()));
        set.add(glyphId);
      }
    }
    return new Map<number, Uint16Array>([...wanted].map(([face, ids]) => [face, Uint16Array.from(ids)]));
  }

  addOutlines(faceId: number, glyphIds: Uint16Array, records: Uint8Array, offsets: Uint32Array): void {
    this.outlines.add(faceId, glyphIds, records, offsets);
  }

  /** Sizes `target` to the page in device px and paints it. Every outline must be present. */
  paint(target: PaintTarget, pageNumber: number, scale: DeviceScale): PaintOutcome {
    const page: PageOps = this.page(pageNumber);
    const size: { readonly w: number; readonly h: number } = pageSizePx(page.entry.width, page.entry.height, scale);
    target.resize(size.w, size.h);
    const links: LinkArea[] = paintPage({
      ctx: target.ctx, scale, faces: this.heldPage(pageNumber).faces, atlas: this.atlas, outlines: this.outlines,
      paper: this.options.paper, placeholder: this.options.placeholder,
      images: (contentId: string): PaintableImage | undefined => this.images.get(contentId),
    }, page);
    return { links, atlas: this.atlas.stats() };
  }
}
