/**
 * Images on the canvas, over the real cdoc-edit and both renderers: a DOCX holding a PNG, a JPEG
 * and a GIF (fixtures/png-jpeg-gif.docx). PNG and JPEG are decoded once each and drawn at their
 * display-list rects; the GIF, which the canvas does not draw (nor PDF), is a box labelled with
 * its type. The canvas puts every image where the PDF export does. Decoding is the fake
 * decoder (node has no createImageBitmap); everything else is production code.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { waitFor } from '@testing-library/react';
import type { Call } from '@/lib/cdoc/paint/__tests__/recording-canvas';
import { mount, settled, statedViewport, type, type Mounted } from './editor-harness';

statedViewport();

const DOCX: Uint8Array = new Uint8Array(readFileSync(join(__dirname, '..', '..', '..', 'lib', 'cdoc', '__tests__', 'fixtures', 'png-jpeg-gif.docx')));
/** CSS px per point at zoom 1, dpr 1: 96 dpi over 72. */
const PX_PER_PT: number = 96 / 72;

interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

const calls = (m: Mounted): Call[] => m.runtime.painted.flatMap((t) => t.calls);
const drawn = (m: Mounted): Box[] => calls(m).filter((c) => c.name === 'drawImage').map((c) => {
  const [, x, y, w, h] = c.args as [unknown, number, number, number, number];
  return { x, y, w, h };
});

/** Image placements in the PDF's page content, as top-left boxes in points: `cm` + `Do` for pictures, `re` for placeholders. */
interface PdfImages { readonly pictures: Box[]; readonly placeholders: Box[] }

function pdfBoxes(pdf: Uint8Array, pageHeightPt: number): PdfImages {
  const text: string = Buffer.from(pdf).toString('latin1');
  const pictures: Box[] = [];
  const placeholders: Box[] = [];
  for (const m of text.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let content: string;
    try { content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { content = m[1]; }
    for (const c of content.matchAll(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s+\/Im\d+ Do/g)) {
      const [w, h, x, y] = c.slice(1, 5).map(Number);
      pictures.push({ x, y: pageHeightPt - y - h, w, h });
    }
    for (const c of content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\s+B/g)) {
      const [x, y, w, h] = c.slice(1, 5).map(Number);
      placeholders.push({ x, y: pageHeightPt - y - h, w, h });
    }
  }
  return { pictures, placeholders };
}

const inPoints = (b: Box): Box => ({ x: b.x / PX_PER_PT, y: b.y / PX_PER_PT, w: b.w / PX_PER_PT, h: b.h / PX_PER_PT });
/** Within one device pixel, the canvas's rounding. */
const near = (a: Box, b: Box): boolean => [a.x - b.x, a.y - b.y, a.w - b.w, a.h - b.h].every((d: number): boolean => Math.abs(d) <= 1 / PX_PER_PT);

describe.each(['worker', 'main-thread'] as const)('images on the %s canvas', (mode) => {
  it('draws PNG and JPEG decoded once each, and the GIF as a box labelled with its type', async () => {
    const m: Mounted = await mount(mode, { from: { kind: 'bytes', bytes: DOCX, format: 'docx' } });
    await waitFor(() => expect(drawn(m)).toHaveLength(2));
    expect(m.runtime.images.decoded.sort()).toEqual(['image/jpeg', 'image/png']);
    expect(calls(m).some((c) => c.name === 'fillText' && c.args[0] === 'image/gif')).toBe(true);
    // A keystroke repaints the page, which draws both pictures again from the cache.
    type(m.input, 'x');
    await settled(m.editor);
    await waitFor(() => expect(drawn(m).length).toBeGreaterThanOrEqual(4));
    expect(m.runtime.images.decoded).toHaveLength(2);
  });

  it('puts every image where the PDF export does', async () => {
    const m: Mounted = await mount(mode, { from: { kind: 'bytes', bytes: DOCX, format: 'docx' } });
    await waitFor(() => expect(drawn(m)).toHaveLength(2));
    const heightPt: number = m.editor.pageSizes[1] / 100;
    const pdf: PdfImages = pdfBoxes((await m.editor.exportAs({ format: 'pdf', nowRfc3339: '2026-10-18T00:00:00Z' })).bytes, heightPt);
    const canvas: Box[] = drawn(m).map(inPoints);
    expect(pdf.pictures).toHaveLength(2);
    for (const picture of pdf.pictures) expect(canvas.some((c: Box) => near(c, picture))).toBe(true);
    const boxes: Box[] = calls(m).filter((c) => c.name === 'strokeRect').map((c) => {
      const [x, y, w, h] = c.args as [number, number, number, number];
      return inPoints({ x: x - 0.5, y: y - 0.5, w: w + 1, h: h + 1 });
    });
    expect(pdf.placeholders).toHaveLength(1);
    expect(boxes.some((b: Box) => near(b, pdf.placeholders[0]))).toBe(true);
  });
});
