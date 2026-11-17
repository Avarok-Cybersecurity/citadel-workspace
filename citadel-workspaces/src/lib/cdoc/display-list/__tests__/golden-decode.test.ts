/**
 * The goldens decode to what the Rust reader (cdoc_paint::decode) says they hold: per page,
 * every op kind's count, the document table, the glyph count, a checksum over each glyph's id, cluster, advance and
 * offsets, the bytes of run text, and the first run's pen positions and text. goldens.json was written by that reader, not by this one.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDisplayList } from '../decoder';
import { decodePage } from '../page-ops';
import type { DisplayList, DocumentTable, Op, OpKind } from '../types';

interface ExpectedPage {
  number: number;
  width: number;
  height: number;
  counts: Record<OpKind, number>;
  glyphs: number;
  textSum: number;
  firstRunPens: number[];
  firstRunText: string;
  textBytes: number;
}
interface Golden { file: string; sha256: string; faces: number; document: DocumentTable; pages: ExpectedPage[] }

const FIXTURES: string = join(__dirname, 'fixtures');
const goldens: Golden[] = (JSON.parse(readFileSync(join(FIXTURES, 'goldens.json'), 'utf8')) as { goldens: Golden[] }).goldens;

interface Seen { counts: Record<string, number>; glyphs: number; textSum: number; firstRunPens: number[]; firstRunText: string; textBytes: number }

const UTF8: TextEncoder = new TextEncoder();

function pensOf(op: Extract<Op, { kind: 'glyphRun' }>): number[] {
  const pens: number[] = [op.head.x];
  op.advances.forEach((advance: number) => pens.push(pens[pens.length - 1] + advance));
  return pens;
}

function summarise(ops: readonly Op[]): Seen {
  const seen: Seen = { counts: {}, glyphs: 0, textSum: 0, firstRunPens: [], firstRunText: '', textBytes: 0 };
  for (const op of ops) {
    seen.counts[op.kind] = (seen.counts[op.kind] ?? 0) + 1;
    if (op.kind !== 'glyphRun') continue;
    op.glyphIds.forEach((id: number, i: number) => {
      seen.textSum += id + op.clusters[i] + op.advances[i] + op.dx[i] + op.dy[i];
    });
    seen.glyphs += op.glyphIds.length;
    seen.textBytes += UTF8.encode(op.text).length;
    if (seen.firstRunPens.length === 0) {
      seen.firstRunPens = pensOf(op);
      seen.firstRunText = op.text;
    }
  }
  return seen;
}

describe.each(goldens)('golden $file', (golden: Golden) => {
  const bytes: Buffer = readFileSync(join(FIXTURES, golden.file));

  it('is the file goldens.json describes', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(golden.sha256);
  });

  it('decodes, page by page, to what the Rust reader decoded', () => {
    const list: DisplayList = openDisplayList(bytes);
    expect(list.faces).toHaveLength(golden.faces);
    expect(list.document, 'the document table').toEqual(golden.document);
    expect(list.pages.map((p) => [p.number, p.width, p.height])).toEqual(golden.pages.map((p) => [p.number, p.width, p.height]));
    golden.pages.forEach((page: ExpectedPage, slot: number) => {
      const seen: Seen = summarise(decodePage(list, slot).ops);
      const nonZero: Record<string, number> = Object.fromEntries(Object.entries(page.counts).filter(([, n]) => n > 0));
      expect(seen.counts, `page slot ${slot} op counts`).toEqual(nonZero);
      expect(seen.glyphs, `page slot ${slot} glyphs`).toBe(page.glyphs);
      expect(seen.textSum, `page slot ${slot} glyph checksum`).toBe(page.textSum);
      expect(seen.firstRunPens, `page slot ${slot} pens`).toEqual(page.firstRunPens);
      expect(seen.firstRunText, `page slot ${slot} first run's text`).toBe(page.firstRunText);
      expect(seen.textBytes, `page slot ${slot} text bytes`).toBe(page.textBytes);
    });
  });
});

describe('a buffer cut short after page N', () => {
  const bytes: Buffer = readFileSync(join(FIXTURES, 'hundred-pages.bin'));
  const full: DisplayList = openDisplayList(bytes);
  const n: number = 41;
  const cut: Uint8Array = new Uint8Array(bytes.subarray(0, full.pages[n].offset + full.pages[n].length));

  // Every page 0..=N by its op sequence, and the first page and page N (the one ending at the cut)
  // op for op. Deep-comparing all 42 cost 1.3 s locally, nearly all of it toEqual (decoding all
  // 100 pages takes 64 ms), and timed out at 5 s on a slow CI runner.
  it('still opens and serves pages 0..=N as the full buffer does', () => {
    const partial: DisplayList = openDisplayList(cut);
    const kinds = (list: DisplayList, slot: number): string => decodePage(list, slot).ops.map((o: { readonly kind: string }): string => o.kind).join(' ');
    for (let slot: number = 0; slot <= n; slot++) expect(kinds(partial, slot), `page slot ${slot}`).toBe(kinds(full, slot));
    for (const slot of [0, n]) expect(decodePage(partial, slot).ops).toEqual(decodePage(full, slot).ops);
  });

  it('refuses page N + 1, which it does not hold', () => {
    expect(() => decodePage(openDisplayList(cut), n + 1)).toThrow(/truncated/);
  });

  it('refuses a cut inside the page index', () => {
    expect(() => openDisplayList(bytes.subarray(0, full.indexEnd - 1))).toThrow(/truncated/);
  });
});
