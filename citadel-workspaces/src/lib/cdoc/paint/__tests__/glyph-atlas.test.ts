/**
 * The atlas: a glyph is rasterised once per (face, glyph, size, phase, colour) and reused;
 * a full class evicts its least recently used glyph; a glyph too big for any cell is filled
 * from its path. Measured through the recording port's atlas surfaces and the page target.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDisplayList } from '../../display-list/decoder';
import type { DisplayList } from '../../display-list/types';
import type { AtlasStats } from '../glyph-atlas';
import { PageRasterizer, type RasterizerOptions } from '../page-rasterizer';
import { deviceScale } from '../units';
import { RASTERIZER_OPTIONS } from '../paint-config';
import { boxBatch, boxGlyphRecord, recordingPort, recordingTarget, type Call, type RecordingPort, type RecordingTarget } from './recording-canvas';

const FIXTURE: string = join(__dirname, '..', '..', 'display-list', '__tests__', 'fixtures', 'kitchen-sink.bin');

interface Rig { r: PageRasterizer; rec: RecordingPort; dl: DisplayList }

function rig(atlas: RasterizerOptions['atlas']): Rig {
  const dl: DisplayList = openDisplayList(new Uint8Array(readFileSync(FIXTURE)));
  const rec: RecordingPort = recordingPort();
  const r: PageRasterizer = new PageRasterizer(rec.port, { atlas, paper: '#fff', placeholder: RASTERIZER_OPTIONS.placeholder, imageCacheBytes: RASTERIZER_OPTIONS.imageCacheBytes });
  r.setList(dl);
  for (const [face, ids] of r.missingGlyphs(0)) {
    const { records, offsets } = boxBatch(ids.length, boxGlyphRecord(40, -10, 480, 700));
    r.addOutlines(face, ids, records, offsets);
  }
  return { r, rec, dl };
}

const paint = (r: PageRasterizer, zoom: number): AtlasStats => r.paint(recordingTarget(), 0, deviceScale(zoom, 1)).atlas;
const rasterised = (rec: RecordingPort): number => rec.surfaces.reduce((n: number, s) => n + s.calls.filter((c: Call) => c.name === 'fill').length, 0);

describe('the glyph atlas', () => {
  it('rasterises each glyph once and serves every later paint from the cache', () => {
    const { r, rec } = rig({ cellSizes: [16, 32, 64, 128], surfaceSide: 1024 });
    const first: AtlasStats = paint(r, 1);
    const fills: number = rasterised(rec);
    const second: AtlasStats = paint(r, 1);
    expect(first.misses).toBeGreaterThan(0);
    expect(second.misses).toBe(first.misses);
    expect(second.hits - first.hits).toBe(first.hits + first.misses);
    expect(rasterised(rec)).toBe(fills);
  });

  it('keys by pixel size: the same glyphs at another zoom are new cells', () => {
    // Painting at 100% first must not change what 200% costs: none of its cells may be reused.
    const config: RasterizerOptions['atlas'] = { cellSizes: [16, 32, 64, 128], surfaceSide: 1024 };
    const shared: PageRasterizer = rig(config).r;
    const atOne: AtlasStats = paint(shared, 1);
    const afterBoth: AtlasStats = paint(shared, 2);
    const alone: AtlasStats = paint(rig(config).r, 2);
    expect(afterBoth.misses - atOne.misses).toBe(alone.misses);
    expect(afterBoth.hits - atOne.hits).toBe(alone.hits);
  });

  it('evicts the least recently used glyph when a class is full', () => {
    const { r } = rig({ cellSizes: [64], surfaceSide: 64 });
    const first: AtlasStats = paint(r, 1);
    expect(first.evictions).toBe(first.misses - 1);
    const second: AtlasStats = paint(r, 1);
    expect(second.misses).toBeGreaterThan(first.misses);
  });

  it('fills a glyph too big for every cell straight from its path', () => {
    const { r } = rig({ cellSizes: [16], surfaceSide: 256 });
    const target: RecordingTarget = recordingTarget();
    const stats: AtlasStats = r.paint(target, 0, deviceScale(4, 2)).atlas;
    expect(stats.direct).toBeGreaterThan(0);
    const transforms: Call[] = target.calls.filter((c: Call) => c.name === 'setTransform' && c.args[0] !== 1);
    expect(transforms.length).toBe(stats.direct);
    expect(transforms[0].args[3]).toBe(-(transforms[0].args[0] as number));
  });

  it('places glyphs at whole device pixels, carrying the quarter-pixel phase in the cell', () => {
    const { r } = rig({ cellSizes: [16, 32, 64, 128], surfaceSide: 1024 });
    const target: RecordingTarget = recordingTarget();
    r.paint(target, 0, deviceScale(1.37, 1.5));
    for (const call of target.calls.filter((c: Call) => c.name === 'drawImage')) {
      expect(Number.isInteger(call.args[5]) && Number.isInteger(call.args[6])).toBe(true);
    }
  });
});
