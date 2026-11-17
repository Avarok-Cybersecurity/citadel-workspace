/**
 * Measures the Citadel Docs paint path on the 100-page golden display list: decode (header,
 * tables and every page body), first-page paint from a cold atlas, and the atlas hit rate over
 * painting every page. Shared by scripts/check-cdoc-paint-perf.mjs (via paint-perf-cli.ts, prints numbers) and
 * paint-perf.test.ts (asserts the measurement ran, never a time).
 *
 * The context is a no-op 2d context: node has no canvas. So "paint" here is the painter's own
 * work (op decode, glyph placement, rounding, atlas bookkeeping and the calls it issues), not
 * the browser's rasterisation, which only a browser can measure.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openDisplayList } from '../../display-list/decoder';
import { decodePage } from '../../display-list/page-ops';
import type { DisplayList, FaceKey } from '../../display-list/types';
import { FONT_MANIFEST } from '../../generated/font-manifest';
import { fileFontSource, realWasm } from '../wasm-rig';
import { nullPort, nullTarget } from './null-canvas';
import type { AtlasStats } from '../../paint/glyph-atlas';
import { PageRasterizer } from '../../paint/page-rasterizer';
import { RASTERIZER_OPTIONS } from '../../paint/paint-config';
import { deviceScale, type DeviceScale } from '../../paint/units';
import type { CdocWasm, RenderAssets } from '../../engine/cdoc-wasm-api';

export const GOLDEN: string = join(process.cwd(), 'src/lib/cdoc/display-list/__tests__/fixtures/hundred-pages.bin');

export interface PaintPerf {
  readonly pages: number;
  readonly bytes: number;
  readonly decodeMs: number;
  readonly outlineMs: number;
  readonly firstPaintMs: number;
  readonly allPagesPaintMs: number;
  readonly atlas: AtlasStats;
  readonly hitRate: number;
}

function median(runs: number[]): number {
  const sorted: number[] = [...runs].sort((a: number, b: number) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function decodeAll(bytes: Uint8Array): DisplayList {
  const list: DisplayList = openDisplayList(bytes);
  for (let slot: number = 0; slot < list.pages.length; slot++) decodePage(list, slot);
  return list;
}

export async function measurePaint(runs: number, zoom: number, dpr: number): Promise<PaintPerf> {
  const bytes: Uint8Array = new Uint8Array(readFileSync(GOLDEN));
  decodeAll(bytes); // warm the JIT before timing
  const decodeMs: number = median(Array.from({ length: runs }, (): number => {
    const t: number = performance.now();
    decodeAll(bytes);
    return performance.now() - t;
  }));

  const list: DisplayList = openDisplayList(bytes);
  const wasm: CdocWasm = realWasm();
  const assets: RenderAssets = new wasm.RenderAssets(FONT_MANIFEST.fallback, '1970-01-01T00:00:00Z');
  for (const face of FONT_MANIFEST.faces) assets.addFont(face.family, face.bold, face.italic, await fileFontSource.load(face));

  const painter: PageRasterizer = new PageRasterizer(nullPort, RASTERIZER_OPTIONS);
  painter.setList(list);
  const t0: number = performance.now();
  for (const entry of list.pages) {
    for (const [faceId, ids] of painter.missingGlyphs(entry.number)) {
      const face: FaceKey = painter.faceKey(faceId);
      const parts: Uint8Array[] = Array.from(ids, (id: number) => wasm.glyph_path(assets, face.family, face.bold, face.italic, id));
      const offsets: Uint32Array = new Uint32Array(parts.length + 1);
      parts.forEach((p: Uint8Array, i: number) => { offsets[i + 1] = offsets[i] + p.length; });
      const records: Uint8Array = new Uint8Array(offsets[parts.length]);
      parts.forEach((p: Uint8Array, i: number) => records.set(p, offsets[i]));
      painter.addOutlines(faceId, ids, records, offsets);
    }
  }
  const outlineMs: number = performance.now() - t0;

  const scale: DeviceScale = deviceScale(zoom, dpr);
  const t1: number = performance.now();
  painter.paint(nullTarget, list.pages[0].number, scale);
  const firstPaintMs: number = performance.now() - t1;
  const t2: number = performance.now();
  let atlas: AtlasStats = painter.paint(nullTarget, list.pages[0].number, scale).atlas;
  for (const entry of list.pages.slice(1)) atlas = painter.paint(nullTarget, entry.number, scale).atlas;
  const allPagesPaintMs: number = performance.now() - t2;
  assets.free();
  return {
    pages: list.pages.length, bytes: bytes.length, decodeMs, outlineMs, firstPaintMs, allPagesPaintMs, atlas,
    hitRate: atlas.hits / (atlas.hits + atlas.misses),
  };
}
