/**
 * The worker side of the protocol: answers each request from the engine, and paints attached
 * OffscreenCanvases itself (outlines come straight from cdoc-wasm here, no round trip). One
 * document is open at a time, static or editable. The worker entry and InProcessCdocClient
 * both run exactly this class.
 */
import type { CdocEngine, GlyphPathBatch, OpenedDocument } from '../engine/cdoc-engine';
import type { EditorEngine } from '../engine/editor-engine';
import { openDisplayList } from '../display-list/decoder';
import type { CanvasPort, PaintTarget } from '../paint/canvas-port';
import { PageRasterizer, type PaintOutcome, type RasterizerOptions } from '../paint/page-rasterizer';
import { deviceScale } from '../paint/units';
import { transferablesOf, type CdocKind, type CdocRequest, type CdocResponse, type CdocResults, type RequestOf } from './protocol';
import { openEditor, serveEditor } from './editor-host';
import { ImageResolver } from '../paint/image-resolve';

export interface CdocHostDeps {
  /** Called once, on the first request that needs the engine. */
  readonly engine: () => Promise<CdocEngine>;
  readonly port: CanvasPort;
  readonly rasterizer: RasterizerOptions;
  readonly target: (canvas: OffscreenCanvas) => PaintTarget;
}

export interface HostReply {
  readonly response: CdocResponse;
  readonly transfer: Transferable[];
}

/** What paints: the static document (CdocEngine) or the editor's replica (EditorEngine). */
interface PaintSource {
  paint(pages: readonly number[]): Uint8Array;
}

export class CdocHost {
  private engine: Promise<CdocEngine> | null = null;
  private readonly canvases: Map<number, PaintTarget> = new Map<number, PaintTarget>();
  private painter: PageRasterizer;
  private source: PaintSource | null = null;
  private editor: EditorEngine | null = null;
  private readonly images: ImageResolver;

  constructor(private readonly deps: CdocHostDeps) {
    this.painter = new PageRasterizer(deps.port, deps.rasterizer);
    this.images = new ImageResolver(deps.port, (contentId: string): Promise<Uint8Array | null> => this.imageRecord(contentId));
  }

  private getEngine(): Promise<CdocEngine> {
    this.engine ??= this.deps.engine();
    return this.engine;
  }

  /** A new document: the last one's pages, outlines and editor do not carry over. */
  private replace(source: PaintSource, editor: EditorEngine | null): void {
    this.editor?.dispose();
    this.editor = editor;
    this.source = source;
    this.painter.dispose();
    this.painter = new PageRasterizer(this.deps.port, this.deps.rasterizer);
  }

  private requireSource(): PaintSource {
    if (this.source === null) throw new Error('no document is open');
    return this.source;
  }

  private requireEditor(): EditorEngine {
    if (this.editor === null) throw new Error('no editor is open');
    return this.editor;
  }

  /** The editor's image record; null for an id it does not hold, or a read-only document. */
  private async imageRecord(contentId: string): Promise<Uint8Array | null> {
    if (this.editor === null) return null;
    try {
      return this.editor.image(contentId);
    } catch {
      // An image from a peer lives in the content store, not here: drawn as "not available".
      return null;
    }
  }

  private async paintCanvas(engine: CdocEngine, req: RequestOf<'paintCanvas'>): Promise<PaintOutcome> {
    const target: PaintTarget | undefined = this.canvases.get(req.slot);
    if (target === undefined) throw new Error(`no canvas is attached in slot ${req.slot}`);
    if (!this.painter.holds(req.pageNumber)) this.painter.setList(openDisplayList(this.requireSource().paint([req.pageNumber])));
    for (const [faceId, glyphIds] of this.painter.missingGlyphs(req.pageNumber)) {
      const batch: GlyphPathBatch = engine.glyphPaths(this.painter.faceKey(faceId), glyphIds);
      this.painter.addOutlines(faceId, glyphIds, batch.records, batch.offsets);
    }
    await this.images.fill(this.painter, req.pageNumber);
    return this.painter.paint(target, req.pageNumber, deviceScale(req.zoom, req.dpr));
  }

  private async result(req: CdocRequest): Promise<CdocResults[CdocKind]> {
    const engine: CdocEngine = await this.getEngine();
    switch (req.kind) {
      case 'open': {
        const opened: OpenedDocument = await engine.open(req.source);
        this.replace(engine, null);
        return opened;
      }
      case 'editorOpen': {
        const { editor, result } = await openEditor(engine, req);
        this.replace(editor, editor);
        return result;
      }
      case 'paint': return { displayList: this.requireSource().paint(req.pages) };
      case 'glyphPaths': return engine.glyphPaths(req.face, req.glyphIds);
      case 'faceMetrics': return { metrics: engine.faceMetrics(req.face) };
      case 'attachCanvas':
        this.canvases.set(req.slot, this.deps.target(req.canvas));
        return { slot: req.slot };
      case 'detachCanvas':
        this.canvases.delete(req.slot);
        return { slot: req.slot };
      case 'paintCanvas': return this.paintCanvas(engine, req);
      case 'invalidatePages':
        this.painter.invalidate(req.pages);
        return { pages: req.pages };
      case 'apply': case 'applyRemote': case 'hitTest': case 'snapshot': case 'awareness': case 'peerView': case 'pageSizes':
      case 'stateVector': case 'encodeDiff': case 'encodeDiffChunked': case 'gc': case 'addImage': case 'selectionText': case 'styles': case 'image': case 'exportAs': case 'missingPatterns':
        return serveEditor(engine, this.requireEditor(), req);
      default: {
        const unrouted: never = req;
        throw new Error(`no route for request ${(unrouted as { readonly kind: string }).kind}`);
      }
    }
  }

  async handle(req: CdocRequest): Promise<HostReply> {
    try {
      const result: CdocResults[CdocKind] = await this.result(req);
      return { response: { id: req.id, ok: true, result }, transfer: transferablesOf(result) };
    } catch (error: unknown) {
      return { response: { id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) }, transfer: [] };
    }
  }
}
