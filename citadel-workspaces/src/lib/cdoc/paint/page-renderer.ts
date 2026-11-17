/**
 * How a page view gets pixels onto a page canvas, behind one interface with two answers:
 *
 * - WorkerPageRenderer: the canvas's control moves to the worker (OffscreenCanvas), which
 *   decodes, rasterises and paints there. The main thread only posts "paint page N at zoom z".
 * - MainThreadPageRenderer: for a browser without transferControlToOffscreen. The display list
 *   and outlines come from the worker; decoding and painting happen here.
 *
 * Every paint waits in one PaintQueue (PAINT_CONCURRENCY at a time, pages in view first, the
 * latest request of a slot winning): a zoom gesture can request several, and a scroll paints
 * pages ahead without delaying the one coming into view.
 */
import { openDisplayList } from '../display-list/decoder';
import type { CdocClient } from '../worker/cdoc-client';
import type { GlyphPathBatch } from '../engine/cdoc-engine';
import type { CanvasPort, PaintTarget } from './canvas-port';
import { PageRasterizer, type PaintOutcome, type RasterizerOptions } from './page-rasterizer';
import { deviceScale } from './units';
import { ImageResolver } from './image-resolve';
import { PaintQueue, type PaintPriority } from './paint-queue';
import { PAINT_CONCURRENCY } from './paint-config';

export interface PageRenderer {
  mount(slot: number, canvas: HTMLCanvasElement): Promise<void>;
  paint(slot: number, pageNumber: number, zoom: number, dpr: number, priority: PaintPriority): Promise<PaintOutcome>;
  unmount(slot: number): void;
  /** Forget what was painted from the previous document (a new one was opened). */
  reset(): void;
  /** Forget `pages` (an edit changed them); resolves once the next paint of each re-fetches it. */
  invalidate(pages: readonly number[]): Promise<void>;
}

export class WorkerPageRenderer implements PageRenderer {
  private readonly queue: PaintQueue = new PaintQueue(PAINT_CONCURRENCY);

  constructor(
    private readonly client: CdocClient,
    private readonly transfer: (canvas: HTMLCanvasElement) => OffscreenCanvas,
  ) {}

  async mount(slot: number, canvas: HTMLCanvasElement): Promise<void> {
    await this.client.request({ kind: 'attachCanvas', slot, canvas: this.transfer(canvas) });
  }

  paint(slot: number, pageNumber: number, zoom: number, dpr: number, priority: PaintPriority): Promise<PaintOutcome> {
    return this.queue.run(slot, priority, () => this.client.request({ kind: 'paintCanvas', slot, pageNumber, zoom, dpr }));
  }

  /**
   * A detach refused because the client was disposed is not a failure: disposing terminated the
   * worker, and every canvas it held went with it. That is the usual case on leaving a document,
   * since the view that owns the client is torn down before the page canvases inside it.
   */
  unmount(slot: number): void {
    this.queue.drop(slot);
    void this.client.request({ kind: 'detachCanvas', slot }).catch((error: unknown): void => {
      if (!this.client.disposed) console.error('cdoc: detaching a page canvas failed', error);
    });
  }

  reset(): void {}

  async invalidate(pages: readonly number[]): Promise<void> {
    await this.client.request({ kind: 'invalidatePages', pages: [...pages] });
  }
}

export class MainThreadPageRenderer implements PageRenderer {
  private readonly queue: PaintQueue = new PaintQueue(PAINT_CONCURRENCY);
  private readonly targets: Map<number, PaintTarget> = new Map<number, PaintTarget>();
  private rasterizer: PageRasterizer;
  private readonly images: ImageResolver;

  constructor(
    private readonly client: CdocClient,
    private readonly port: CanvasPort,
    private readonly options: RasterizerOptions,
    private readonly targetOf: (canvas: HTMLCanvasElement) => PaintTarget,
  ) {
    this.rasterizer = new PageRasterizer(port, options);
    this.images = new ImageResolver(port, (contentId: string): Promise<Uint8Array | null> => this.client.request({ kind: 'image', contentId }).then(
      ({ record }): Uint8Array => record,
      // Not held by the editor (a peer's image, or a read-only document): drawn as "not available".
      (): null => null,
    ));
  }

  mount(slot: number, canvas: HTMLCanvasElement): Promise<void> {
    this.targets.set(slot, this.targetOf(canvas));
    return Promise.resolve();
  }

  paint(slot: number, pageNumber: number, zoom: number, dpr: number, priority: PaintPriority): Promise<PaintOutcome> {
    return this.queue.run(slot, priority, async (): Promise<PaintOutcome> => {
      const target: PaintTarget | undefined = this.targets.get(slot);
      if (target === undefined) throw new Error(`no canvas is mounted in slot ${slot}`);
      const rasterizer: PageRasterizer = this.rasterizer;
      if (!rasterizer.holds(pageNumber)) {
        const { displayList } = await this.client.request({ kind: 'paint', pages: [pageNumber] });
        rasterizer.setList(openDisplayList(displayList));
      }
      for (const [faceId, glyphIds] of rasterizer.missingGlyphs(pageNumber)) {
        const batch: GlyphPathBatch = await this.client.request({ kind: 'glyphPaths', face: rasterizer.faceKey(faceId), glyphIds: glyphIds.slice() });
        rasterizer.addOutlines(faceId, glyphIds, batch.records, batch.offsets);
      }
      await this.images.fill(rasterizer, pageNumber);
      return rasterizer.paint(target, pageNumber, deviceScale(zoom, dpr));
    });
  }

  unmount(slot: number): void {
    this.queue.drop(slot);
    this.targets.delete(slot);
  }

  reset(): void {
    this.rasterizer.dispose();
    this.rasterizer = new PageRasterizer(this.port, this.options);
  }

  invalidate(pages: readonly number[]): Promise<void> {
    this.rasterizer.invalidate(pages);
    return Promise.resolve();
  }
}
