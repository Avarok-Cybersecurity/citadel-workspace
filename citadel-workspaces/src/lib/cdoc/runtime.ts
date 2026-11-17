/**
 * The Citadel Docs runtime a document view needs: the worker client and the page renderer
 * suited to this browser. Reached only through runtime-loader.ts's dynamic import, so none of
 * cdoc (glue, decoder, painter) is in the bundle until a document opens.
 */
import type { CdocClient } from './worker/cdoc-client';
import { spawnCdocWorkerClient, type SpawnedCdocWorker } from './worker/spawn-worker-client';
import type { ValueStore } from '@/lib/value-store';
import type { EngineLoad } from './worker/engine-load';
import { MainThreadPageRenderer, WorkerPageRenderer, type PageRenderer } from './paint/page-renderer';
import { canvasTarget, domCanvasPort } from './paint/dom-canvas-port';
import { RASTERIZER_OPTIONS } from './paint/paint-config';
import type { Ctx2D } from './paint/canvas-port';

export interface CdocRuntime {
  readonly client: CdocClient;
  readonly renderer: PageRenderer;
  /** The 2D context of an editor overlay canvas (main thread). */
  readonly overlayContext: (canvas: HTMLCanvasElement) => Ctx2D;
  /** How far the engine's download has got, for the page's loading bar; it loads on first use. */
  readonly engineLoad: ValueStore<EngineLoad>;
}

function canTransferCanvases(): boolean {
  return typeof HTMLCanvasElement === 'function' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

function overlayContextOf(canvas: HTMLCanvasElement): Ctx2D {
  const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
  if (ctx === null) throw new Error('this browser gave the editor overlay no 2D canvas context');
  return ctx;
}

export function spawnCdocRuntime(): CdocRuntime {
  const { client, engineLoad }: SpawnedCdocWorker = spawnCdocWorkerClient();
  const renderer: PageRenderer = canTransferCanvases()
    ? new WorkerPageRenderer(client, (canvas: HTMLCanvasElement): OffscreenCanvas => canvas.transferControlToOffscreen())
    : new MainThreadPageRenderer(client, domCanvasPort(), RASTERIZER_OPTIONS, canvasTarget);
  return { client, renderer, overlayContext: overlayContextOf, engineLoad };
}
