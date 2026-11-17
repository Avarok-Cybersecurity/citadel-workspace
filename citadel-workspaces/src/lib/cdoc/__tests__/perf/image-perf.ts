/**
 * Keystroke to paint on a page with pictures (fixtures/png-jpeg-gif.docx), through the editor
 * and the worker renderer into a no-op canvas. Node has no createImageBitmap, so a decode here
 * costs only its bookkeeping; what this proves is how many decodes a keystroke causes (none,
 * once each id is cached), and what the paint costs around them. The control runs the same
 * painter with no room in its image cache (imageCacheBytes 0), so every repaint decodes again.
 */
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InProcessCdocClient } from '../../worker/clients';
import { MainThreadPageRenderer } from '../../paint/page-renderer';
import { RASTERIZER_OPTIONS } from '../../paint/paint-config';
import { EditorSession } from '../../editor/editor-session';
import type { CanvasPort } from '../../paint/canvas-port';
import type { DecodedImage } from '../../paint/image-cache';
import { realHost } from '../wasm-rig';
import { nullPort, nullTarget } from './null-canvas';

export interface ImagePagePerf {
  readonly keystrokes: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  /** Image decodes per keystroke after the first paint. */
  readonly decodesPerKeystroke: number;
}

const DOCX: string = join(process.cwd(), 'src/lib/cdoc/__tests__/fixtures/png-jpeg-gif.docx');
const percentile = (xs: number[], p: number): number => [...xs].sort((a: number, b: number) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

/** `cached: false` is the control. */
export async function measureImagePage(keystrokes: number, cached: boolean): Promise<ImagePagePerf> {
  let decodes: number = 0;
  const port: CanvasPort = {
    ...nullPort,
    decodeImage: (bytes: Uint8Array, mime: string): Promise<DecodedImage> => {
      decodes++;
      return nullPort.decodeImage(bytes, mime);
    },
  };
  const client: InProcessCdocClient = new InProcessCdocClient(realHost(nullPort, (): typeof nullTarget => nullTarget));
  const options: typeof RASTERIZER_OPTIONS = cached ? RASTERIZER_OPTIONS : { ...RASTERIZER_OPTIONS, imageCacheBytes: 0 };
  const renderer: MainThreadPageRenderer = new MainThreadPageRenderer(client, port, options, (): typeof nullTarget => nullTarget);
  const bytes: Uint8Array = new Uint8Array(readFileSync(DOCX));
  const editor: EditorSession = await EditorSession.open({ client, renderer }, 1n, { kind: 'bytes', bytes, format: 'docx' });
  await renderer.mount(0, {} as HTMLCanvasElement);
  await renderer.paint(0, 0, 1, 2, 'visible');
  const firstPaint: number = decodes;
  const times: number[] = [];
  for (let i: number = 0; i < keystrokes; i++) {
    const t: number = performance.now();
    await editor.execute({ name: 'insertText', text: 'e' });
    await renderer.paint(0, 0, 1, 2, 'visible');
    times.push(performance.now() - t);
  }
  return { keystrokes, p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), decodesPerKeystroke: (decodes - firstPaint) / keystrokes };
}
