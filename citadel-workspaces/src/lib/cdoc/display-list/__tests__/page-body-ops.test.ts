/**
 * The ops of a page body that carry text and where it came from (`docs/display-list.md` v5):
 * GLYPH_RUN, decoded from its predictions and sparse columns against the spec's own vectors
 * (the two runs of every-op.bin), CARET_LINES, checked and counted, and SIG_FIELD; and what
 * each refuses.
 */
import { describe, expect, it } from 'vitest';
import { decodePage } from '../page-ops';
import type { DisplayList, DocumentTable, Face, Op, Strike } from '../types';

const NO_DOCUMENT: DocumentTable = { title: null, language: null, outline: [] };

/** every-op.bin's face 1 (docs/display-list.md § The glyphs): glyph table 65535/0, 3/1130, 300/1200, 301/0; f→0, ' '→1, é→2. */
const CARLITO: Face = {
  faceId: 1, family: 'Carlito', bold: false, italic: false, unitsPerEm: 2048,
  glyphs: [{ glyphId: 65535, advance: 0 }, { glyphId: 3, advance: 1130 }, { glyphId: 300, advance: 1200 }, { glyphId: 301, advance: 0 }],
  chars: { ascii: Int32Array.from({ length: 0x80 }, (_: unknown, cp: number): number => (cp === 0x66 ? 0 : cp === 0x20 ? 1 : -1)), other: new Map([[0xe9, 2]]) },
};
const EMPTY_FACE: Face = { faceId: 0, family: 'Carlito', bold: false, italic: false, unitsPerEm: 2048, glyphs: [], chars: { ascii: new Int32Array(0x80).fill(-1), other: new Map() } };
/** Strike 0: face 1 at 11 pt, bases 0, 606, 644, 0. */
const STRIKE: Strike = { faceId: 1, size: 1100, ids: Uint16Array.of(65535, 3, 300, 301), bases: Int32Array.of(0, 606, 644, 0) };

function bodyList(body: number[], strings: readonly string[] = []): DisplayList {
  return {
    view: new DataView(new Uint8Array(body).buffer),
    faces: [EMPTY_FACE, CARLITO],
    strikes: [STRIKE],
    strings,
    document: NO_DOCUMENT,
    pages: [{ number: 0, offset: 0, length: body.length, width: 59530, height: 84190 }],
    indexEnd: 0,
  };
}

type Glyphs = [number, number, number, number, number][];
function glyphsOf(body: number[]): Glyphs {
  const op: Op = decodePage(bodyList(body), 0).ops[0];
  if (op.kind !== 'glyphRun') throw new Error(`a ${op.kind}`);
  return [...op.glyphIds].map((id: number, i: number): [number, number, number, number, number] => [id, op.clusters[i], op.advances[i], op.dx[i], op.dy[i]]);
}

/** A GLYPH_RUN op of `payload`: strike 0, opaque black at (7200, -1), then the text and glyphs. */
const glyphRun = (rest: number[]): number[] => {
  const payload: number[] = [0x00, 0xff, 0x00, 0x00, 0x80, 0xc0, 0x70, 0x01, ...rest];
  return [0x11, payload.length, ...payload];
};

describe('a glyph run', () => {
  it('predicts every glyph it does not list: the spec\'s first run, "fé " with only a plus-one bitmap', () => {
    // 3 glyphs; flags: plus-one bitmap; bitmap: glyph 1 is base + 1.
    expect(glyphsOf(glyphRun([0x04, 0x66, 0xc3, 0xa9, 0x20, 0x03, 0x04, 0x02]))).toEqual([[65535, 0, 0, 0, 0], [300, 1, 645, 0, 0], [3, 3, 606, 0, 0]]);
  });

  it('reads every column of the spec\'s second run, "fi é", as every-op.bin holds it', () => {
    const rest: number[] = [
      0x05, 0x66, 0x69, 0x20, 0xc3, 0xa9, 0x04, 0x3b,
      0x02, 0x03, 0x03, // glyph indices: glyph 3 is index 3 (301)
      0x04, 0x01, 0x02, 0x01, 0x03, // clusters: glyph 1 +1 (2), glyph 3 -2 (3)
      0x08, 0x00, 0x80, 0x08, 0x00, 0xc9, 0x09, 0x00, 0x57, // advances: +512, -613, -44 from the base
      0x05, 0x00, 0x27, 0x02, 0xd7, 0x04, // x offsets: glyph 0 -20, glyph 3 -300
      0x05, 0x00, 0x50, 0x02, 0x8f, 0x03, // y offsets: glyph 0 +40, glyph 3 -200
    ];
    expect(glyphsOf(glyphRun(rest))).toEqual([[65535, 0, 512, -20, 40], [3, 2, -7, 0, 0], [300, 3, 600, 0, 0], [301, 3, 0, -300, -200]]);
  });

  // "aé" (é is two bytes), two glyphs, the second's cluster listed as `delta` from its prediction (1).
  const clustered = (delta: number): number[] => glyphRun([0x03, 0x61, 0xc3, 0xa9, 0x02, 0x02, 0x02, 0x01, delta]);

  it('accepts a cluster at the end of its text', () => {
    expect(glyphsOf(clustered(4)).map((g) => g[1])).toEqual([0, 3]);
  });

  it.each([
    [2, 'inside a character'],
    [6, 'past the text'],
    [3, 'before the start of its text'],
  ])('refuses a listed cluster (zz %d) %s', (delta: number) => {
    expect(() => decodePage(bodyList(clustered(delta)), 0)).toThrow(/cluster -?\d+ decreases or is not a character boundary/);
  });

  it.each([
    ['unknown column flags', [0x01, 0x61, 0x01, 0x40], /unknown glyph-run column flags/],
    ['set padding bits in the bitmap', [0x01, 0x61, 0x01, 0x04, 0x02], /padding bits are set/],
    ['a glyph index past the glyph table', [0x01, 0x61, 0x01, 0x01, 0x02, 0x00, 0x04], /glyph index 4 is past the glyph table/],
    ['a column entry past the last glyph', [0x01, 0x61, 0x01, 0x10, 0x02, 0x01, 0x02], /past the run's last/],
    ['more glyphs than its text could shape', [0x01, 0x61, 0x11, 0x00], /claims 17 glyphs/],
  ])('refuses %s', (_: string, rest: number[], error: RegExp) => {
    expect(() => decodePage(bodyList(glyphRun(rest)), 0)).toThrow(error);
  });

  it('refuses a strike past the strike table', () => {
    const body: number[] = glyphRun([0x00, 0x00, 0x00]);
    body[2] = 1;
    expect(() => decodePage(bodyList(body), 0)).toThrow(/strike 1 is not in the strike table/);
  });

  it('refuses 0x10, version 1\'s retired TEXT_RUN, as an unknown opcode', () => {
    const body: number[] = glyphRun([0x00, 0x00, 0x00]);
    body[0] = 0x10;
    expect(() => decodePage(bodyList(body), 0)).toThrow(/unknown opcode 0x10/);
  });
});

describe('caret lines', () => {
  const op = (payload: number[]): number[] => [0x40, payload.length, ...payload];
  // One line: new paragraph, no stops; body of section 0, path [0]; step 0, height 0; one run.
  const LINE: number[] = [1, 0x09, 0, 0, 1, 0, 0, 0, 1];

  it('are checked and counted, and drawn by nobody', () => {
    expect(decodePage(bodyList(op(LINE)), 0).ops).toEqual([{ kind: 'caretLines', lines: 1 }]);
  });

  it.each([
    ['a first line that names no paragraph', [1, 0x08, 0, 0, 1], /the first caret line names no paragraph/],
    ['an unknown head', [1, 0x19, 0, 0, 1, 0, 0, 0, 1], /unknown caret line head/],
    ['no lines', [0], /has no lines/],
    ['an unknown region', [1, 0x09, 4, 0, 1, 0, 0, 0, 1], /unknown caret line region 4/],
    ['a line with no runs and no stops', [1, 0x09, 0, 0, 1, 0, 0, 0, 0], /no runs and no stops/],
    ['stops whose gaps do not increase', [1, 0x01, 0, 0, 1, 0, 0, 0, 1, 2, 3, 0, 3, 0], /gaps do not increase/],
  ])('refuse %s', (_: string, payload: number[], error: RegExp) => {
    expect(() => decodePage(bodyList(op(payload)), 0)).toThrow(error);
  });

  it('refuse a payload longer than their lines', () => {
    expect(() => decodePage(bodyList(op([...LINE, 0])), 0)).toThrow(/longer than its fields/);
  });
});

describe('a signature field', () => {
  // Rect (1, 2, 3, 4) as zz, then the field id and the signer role by string index.
  const body: number[] = [0x22, 6, 2, 4, 6, 8, 0, 1];

  it('carries its rect, field id and role', () => {
    expect(decodePage(bodyList(body, ['sig-1', 'Approver']), 0).ops).toEqual([{ kind: 'sigField', rect: { x: 1, y: 2, w: 3, h: 4 }, fieldId: 'sig-1', role: 'Approver' }]);
  });

  it('refuses a role past the string table', () => {
    expect(() => decodePage(bodyList(body, ['sig-1']), 0)).toThrow(/string index 1 is past the string table/);
  });
});

