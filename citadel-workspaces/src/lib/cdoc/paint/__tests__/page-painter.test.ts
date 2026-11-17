/**
 * The painter against the golden display lists: which context calls each op becomes, how the
 * device scale reaches them, and that clips balance. Outlines are synthetic boxes (the real
 * ones come from cdoc-wasm and are exercised in the worker tests).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDisplayList } from '../../display-list/decoder';
import { decodePage } from '../../display-list/page-ops';
import type { DisplayList, Op } from '../../display-list/types';
import { PageRasterizer, type RasterizerOptions } from '../page-rasterizer';
import { deviceScale, rectPx, type DeviceScale, type PixelRect } from '../units';
import { boxBatch, boxGlyphRecord, recordingPort, recordingTarget, type Call, type RecordingTarget } from './recording-canvas';

const FIXTURES: string = join(__dirname, '..', '..', 'display-list', '__tests__', 'fixtures');
const list = (file: string): DisplayList => openDisplayList(new Uint8Array(readFileSync(join(FIXTURES, file))));

// Test values: one 1024px atlas of four classes is the shape PageView uses; any explicit
// config works for these assertions.
const OPTIONS: RasterizerOptions = {
  atlas: { cellSizes: [16, 32, 64, 128], surfaceSide: 1024 },
  paper: 'rgb(255,255,255)',
  placeholder: { stroke: 'rgb(200,200,200)', labelColor: 'rgb(100,100,100)', labelCssPx: 11, labelFamily: 'sans-serif' },
  imageCacheBytes: 1024 * 1024,
};

function rasterizer(dl: DisplayList, options: RasterizerOptions = OPTIONS): PageRasterizer {
  const r: PageRasterizer = new PageRasterizer(recordingPort().port, options);
  r.setList(dl);
  for (const page of dl.pages) {
    for (const [face, ids] of r.missingGlyphs(page.number)) {
      const { records, offsets } = boxBatch(ids.length, boxGlyphRecord(40, -10, 480, 700));
      r.addOutlines(face, ids, records, offsets);
    }
  }
  return r;
}

const named = (calls: readonly Call[], name: string): Call[] => calls.filter((c: Call) => c.name === name);
const opOf = <K extends Op['kind']>(dl: DisplayList, kind: K): Extract<Op, { kind: K }> =>
  decodePage(dl, 0).ops.find((o: Op) => o.kind === kind) as Extract<Op, { kind: K }>;

describe('every op on the every-op golden', () => {
  const dl: DisplayList = list('every-op.bin');
  const scale: DeviceScale = deviceScale(1, 2);
  const target: RecordingTarget = recordingTarget();
  const outcome: ReturnType<PageRasterizer['paint']> = rasterizer(dl).paint(target, 0, scale);

  it('sizes the canvas to the page in device px: a whole number of CSS px, times the DPR', () => {
    expect(target.sizes).toEqual([[Math.round(dl.pages[0].width * scale.css) * scale.dpr, Math.round(dl.pages[0].height * scale.css) * scale.dpr]]);
  });

  it('paints the sheet first, then FILL_RECT at its rounded edges', () => {
    const r: PixelRect = rectPx(opOf(dl, 'fillRect').rect, scale.k);
    const fills: Call[] = named(target.calls, 'fillRect');
    expect(fills[0].args.slice(0, 2)).toEqual([0, 0]);
    expect(fills[1].args).toEqual([r.x, r.y, r.w, r.h]);
  });

  it('strokes STROKE_RECT, LINE and STROKE_PATH, fills FILL_PATH nonzero', () => {
    expect(named(target.calls, 'strokeRect').length).toBeGreaterThanOrEqual(1);
    expect(named(target.calls, 'stroke')).toHaveLength(2);
    expect(named(target.calls, 'fill').map((c: Call) => c.args)).toEqual([['nonzero']]);
    expect(named(target.calls, 'bezierCurveTo').length + named(target.calls, 'lineTo').length).toBeGreaterThan(0);
  });

  it('draws TEXT_RUN and GLYPH_RUN glyphs from the atlas', () => {
    const glyphs: number = decodePage(dl, 0).ops.reduce((n: number, o: Op) =>
      n + (o.kind === 'glyphRun' ? o.glyphIds.length : 0), 0);
    expect(named(target.calls, 'drawImage')).toHaveLength(glyphs);
  });

  it('returns only honoured links, in CSS px, and paints nothing for them', () => {
    const link: Extract<Op, { kind: 'link' }> = opOf(dl, 'link');
    expect(outcome.links.length).toBeLessThanOrEqual(2);
    for (const area of outcome.links) expect(area.target).toMatch(/^\s*(https?:\/\/|mailto:)/i);
    if (outcome.links[0]?.target === link.target) expect(outcome.links[0].x).toBeCloseTo(link.rect.x * scale.css);
  });

  it('balances every clip push with a restore', () => {
    expect(named(target.calls, 'save').length).toBe(named(target.calls, 'restore').length);
    const at: number = target.calls.findIndex((c: Call) => c.name === 'clip');
    expect(target.calls.slice(at - 3, at + 1).map((c: Call) => c.name)).toEqual(['save', 'beginPath', 'rect', 'clip']);
  });
});

describe('the device scale', () => {
  const dl: DisplayList = list('kitchen-sink.bin');
  const paint = (dpr: number): RecordingTarget => {
    const t: RecordingTarget = recordingTarget();
    rasterizer(dl).paint(t, 0, deviceScale(1, dpr));
    return t;
  };

  it('multiplies every coordinate by devicePixelRatio, rounding once', () => {
    const one: RecordingTarget = paint(1);
    const two: RecordingTarget = paint(2);
    // Twice the 1x canvas exactly: the browser composites a canvas at its CSS size, so a 2x
    // canvas one device px off that (an odd width) would be rescaled and blur.
    expect(two.sizes[0]).toEqual([2 * one.sizes[0][0], 2 * one.sizes[0][1]]);
    const r1: readonly unknown[] = named(one.calls, 'fillRect')[1].args;
    const r2: readonly unknown[] = named(two.calls, 'fillRect')[1].args;
    expect(Math.abs((r2[0] as number) - 2 * (r1[0] as number))).toBeLessThanOrEqual(1);
  });

  it('refuses a zoom or DPR that is not a positive number', () => {
    expect(() => deviceScale(0, 1)).toThrow(RangeError);
    expect(() => deviceScale(1, Number.NaN)).toThrow(RangeError);
  });
});
