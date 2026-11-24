/**
 * CW-5 (canvas-ext-abi.md): the cross-language draw-list corpus through the TS host, and the
 * limits the host enforces before painting. Every corpus frame's CBOR (the Rust codec's bytes)
 * decodes, through the production op-argument schema, to its `draw`, and the port reaches the same
 * verdict as the Rust host; a refused frame paints nothing at all. No doubles but the recording
 * surface (a canvas context jsdom does not have).
 *
 * Negative controls (each applied, seen red, reverted): dropping the `checkCanvasDraw` call from
 * the port fails the corpus verdicts and "nothing painted"; counting `label.length` instead of
 * code points fails the emoji-label case; dropping `path` from the wire schema fails every CW-5
 * frame's decode.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_REGIONS_PER_FRAME, PATH_MAX_POINTS } from '../../sdk/generated/AbiConstants';
import type { DrawCommand } from '../../sdk/generated/DrawCommand';
import { sdkSource, type SdkSource } from '../../sdk/__tests__/sdk-paths';
import { canvasPort } from '../canvas-port';
import { checkCanvasDraw, type CanvasDrawVerdict, type CanvasRegion } from '../canvas-limits';
import { decodeCbor, type Decoded } from '../cbor';
import { parseArgs } from '../op-args';
import type { PortAnswer } from '../ports';
import { recordingSurface, type RecordingSurface } from './recording-surface';

/** vitest runs from citadel-workspaces/; the contracts are beside it. */
const MIRROR: string = resolve(process.cwd(), '../docs/contracts/batch-1116/fixtures/canvas-ext/canvas-draw-corpus.json');
const SOURCE: SdkSource = sdkSource('CITADEL_APP_SDK_CANVAS_CORPUS', '../citadel-internal-service/citadel-app-sdk-types/tests/contracts/batch-1116/canvas-draw-corpus.json');

interface Frame {
  readonly name: string;
  readonly draw: { readonly commands: DrawCommand[] };
  readonly cbor_hex: string;
  readonly verdict: { readonly ok: null } | { readonly refused: string; readonly rule: string; readonly command: number };
}

const corpus: { readonly frames: readonly Frame[] } = JSON.parse(readFileSync(MIRROR, 'utf8')) as { frames: Frame[] };
const hex = (h: string): Uint8Array => Uint8Array.from(h.match(/../g) ?? [], (b: string): number => parseInt(b, 16));
const region = (id: string, label: string = id): DrawCommand => ({ region: { id, x: 0, y: 0, w: 16, h: 16, label, role: 'button' } });
const clear: DrawCommand = { clear: { color: 0xff } };

// A test about painting has no overlay to tell; the region tests pass their own listener.
function draw(commands: DrawCommand[], regions: (list: readonly CanvasRegion[]) => void = (): void => undefined): { answer: PortAnswer; s: RecordingSurface } {
  const s: RecordingSurface = recordingSurface();
  return { answer: canvasPort(() => s, regions).CanvasDraw({ commands }) as PortAnswer, s };
}

describe('the CW-5 draw-list corpus', () => {
  it(`is the agent crate's file, byte for byte (${SOURCE.label})`, () => {
    if (!SOURCE.present) return;
    expect(readFileSync(MIRROR).equals(readFileSync(SOURCE.path))).toBe(true);
  });

  it('covers both verdicts, so a host that accepts or refuses everything fails it', () => {
    expect(corpus.frames.filter((f: Frame) => 'ok' in f.verdict).length).toBeGreaterThan(3);
    expect(corpus.frames.filter((f: Frame) => 'refused' in f.verdict).length).toBeGreaterThan(3);
  });

  it.each(corpus.frames.map((f: Frame) => [f.name, f] as const))('%s decodes from its CBOR and reaches its verdict', (_name: string, f: Frame) => {
    const decoded: Decoded = decodeCbor(hex(f.cbor_hex));
    if (!decoded.ok) throw new Error('the frame does not decode');
    expect(parseArgs('CanvasDraw', decoded.value)).toEqual(f.draw);
    const verdict: CanvasDrawVerdict = checkCanvasDraw(f.draw.commands);
    const { answer, s } = draw(f.draw.commands);
    if ('ok' in f.verdict) {
      expect(verdict.ok).toBe(true);
      expect(answer).toEqual({ ok: null });
      return;
    }
    expect(verdict).toEqual({ ok: false, rule: f.verdict.rule, command: f.verdict.command });
    expect(answer).toEqual({ refused: { limit: f.verdict.refused } });
    expect(s.calls).toEqual([]);
  });
});

describe('a CanvasDraw over a CW-5 limit', () => {
  const points = (n: number): [number, number][] => Array.from({ length: n }, (_v: unknown, i: number): [number, number] => [i, 1]);

  it('a path of 257 points is refused and nothing before it is painted (control: 256 paints)', () => {
    const over: ReturnType<typeof draw> = draw([clear, { path: { points: points(PATH_MAX_POINTS + 1), closed: false, fill: null, stroke: [1, 0xff] } }]);
    expect([over.answer, over.s.calls]).toEqual([{ refused: { limit: 'canvas_draw' } }, []]);
    const at: ReturnType<typeof draw> = draw([clear, { path: { points: points(PATH_MAX_POINTS), closed: false, fill: null, stroke: [1, 0xff] } }]);
    expect(at.answer).toEqual({ ok: null });
    expect(at.s.calls.length).toBeGreaterThan(PATH_MAX_POINTS);
  });

  it('a path with neither fill nor stroke is refused (control: either one paints)', () => {
    const p = (fill: number | null, stroke: [number, number] | null): DrawCommand => ({ path: { points: points(3), closed: true, fill, stroke } });
    expect(draw([clear, p(null, null)]).answer).toEqual({ refused: { limit: 'canvas_draw' } });
    expect(draw([p(0xff, null)]).answer).toEqual({ ok: null });
    expect(draw([p(null, [2, 0xff])]).answer).toEqual({ ok: null });
  });

  it('513 regions in one frame are refused, 512 are not', () => {
    const many = (n: number): DrawCommand[] => Array.from({ length: n }, (_v: unknown, i: number): DrawCommand => region(`r${i}`));
    expect(checkCanvasDraw(many(MAX_REGIONS_PER_FRAME + 1))).toEqual({ ok: false, rule: 'too_many_regions', command: null });
    expect(draw(many(MAX_REGIONS_PER_FRAME + 1)).answer).toEqual({ refused: { limit: 'canvas_draw' } });
    expect(draw(many(MAX_REGIONS_PER_FRAME)).answer).toEqual({ ok: null });
  });

  it('counts a label in code points: 256 emoji fit, though they are 512 UTF-16 units', () => {
    expect(draw([region('a', '🙂'.repeat(256))]).answer).toEqual({ ok: null });
    expect(draw([region('a', '🙂'.repeat(257))]).answer).toEqual({ refused: { limit: 'canvas_draw' } });
  });
});

describe('a painted CW-5 frame', () => {
  it('paints circles, arcs and paths in order with ABI-1 commands, and regions paint nothing', () => {
    const { answer, s } = draw([
      { fill_rect: { x: 0, y: 0, w: 2, h: 2, color: 0xff0000ff } },
      { fill_circle: { cx: 5, cy: 6, r: 2, color: 0x00ff00ff } },
      region('n'),
      { stroke_circle: { cx: 5, cy: 6, r: 3, line_width: 1.5, color: 0xff } },
      { arc: { cx: 1, cy: 1, r: 4, start: 0, end: Math.PI / 2, line_width: 2, color: 0xff } },
      { path: { points: [[0, 0], [4, 0], [4, 4]], closed: true, fill: 0x0000ffff, stroke: [1, 0xff] } },
    ]);
    expect(answer).toEqual({ ok: null });
    expect(s.calls).toEqual([
      'rect 0 0 2 2',
      'path', 'arc 5 6 2 0.000 6.283', 'fill rgba(0, 255, 0, 1.000)',
      'path', 'arc 5 6 3 0.000 6.283', 'stroke rgba(0, 0, 0, 1.000) 1.5',
      'path', 'arc 1 1 4 0.000 1.571', 'stroke rgba(0, 0, 0, 1.000) 2',
      'path', 'move 0 0', 'line 4 0', 'line 4 4', 'close', 'fill rgba(0, 0, 255, 1.000)', 'stroke rgba(0, 0, 0, 1.000) 1',
    ]);
  });

  it('reports its regions in draw order, once while unchanged, then an empty list when a frame has none', async () => {
    const told: string[][] = [];
    const s: RecordingSurface = recordingSurface();
    const port: ReturnType<typeof canvasPort> = canvasPort(() => s, (list: readonly CanvasRegion[]): void => { told.push(list.map((r: CanvasRegion) => r.id)); });
    await port.CanvasDraw({ commands: [region('b'), clear, region('a')] });
    await port.CanvasDraw({ commands: [region('b'), region('a')] });
    expect(told).toEqual([['b', 'a']]);
    await port.CanvasDraw({ commands: [region('Bad')] });
    expect(told).toEqual([['b', 'a']]);
    await port.CanvasDraw({ commands: [clear] });
    expect(told).toEqual([['b', 'a'], []]);
  });
});
