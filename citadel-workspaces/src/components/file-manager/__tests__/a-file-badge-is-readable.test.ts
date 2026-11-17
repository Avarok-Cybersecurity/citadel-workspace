/**
 * File-type badges: one tone per family, from one table, each carrying white
 * 10px bold text -- which is small text, so AA asks 4.5:1. The ratio is computed
 * from the tone's own HSL value, so a lighter tone fails here, not in a review.
 */
import { describe, it, expect } from 'vitest';
import { FILE_BADGE_TONES, fileBadge, fileKind } from '../vfs-content-helpers';

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number): number => (n + h / 30) % 12;
  const a: number = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastWithWhite(toneClass: string): number {
  const m: RegExpMatchArray | null = toneClass.match(/hsl\((\d+(?:\.\d+)?)_(\d+(?:\.\d+)?)%_(\d+(?:\.\d+)?)%\)/);
  if (!m) throw new Error(`not an hsl tone: ${toneClass}`);
  const l: number = luminance(hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100));
  return 1.05 / (l + 0.05);
}

describe('file badges', () => {
  it.each(Object.entries(FILE_BADGE_TONES))('%s carries white text at 4.5:1 or better', (_family: string, tone: string) => {
    expect(contrastWithWhite(tone)).toBeGreaterThanOrEqual(4.5);
  });

  it('labels a file by its extension and tones it by its family', () => {
    expect(fileBadge('Q3-Report.PDF')).toEqual({ label: 'PDF', tone: FILE_BADGE_TONES.pdf });
    expect(fileBadge('photo.jpeg')).toEqual({ label: 'JPEG', tone: FILE_BADGE_TONES.image });
    expect(fileBadge('plan.dwg').tone).toBe(FILE_BADGE_TONES.cad);
    expect(fileBadge('deck.pptx').tone).toBe(FILE_BADGE_TONES.slides);
    expect(fileBadge('payroll.csv').tone).toBe(FILE_BADGE_TONES.sheet);
    expect(fileBadge('contract.docx').tone).toBe(FILE_BADGE_TONES.document);
    expect(fileBadge('notes.md').tone).toBe(FILE_BADGE_TONES.text);
    expect(fileBadge('backup.zip').tone).toBe(FILE_BADGE_TONES.archive);
  });

  it('gives a file with no extension a plain badge rather than its whole name', () => {
    expect(fileBadge('Makefile')).toEqual({ label: 'FILE', tone: FILE_BADGE_TONES.other });
  });

  it('keeps a long extension to a badge-sized label', () => {
    expect(fileBadge('model.safetensors').label).toBe('SAFE');
  });

  it('says what kind of file it is', () => {
    expect(fileKind('plan.dwg')).toBe('AutoCAD drawing');
    expect(fileKind('contract.docx')).toBe('Word document');
    expect(fileKind('thing.xyz')).toBe('XYZ file');
    expect(fileKind('Makefile')).toBe('File');
  });
});
