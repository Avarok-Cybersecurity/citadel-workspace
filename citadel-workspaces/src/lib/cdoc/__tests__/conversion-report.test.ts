/** Reading the engine's loss report: every entry must carry a known severity and a label. */
import { describe, expect, it } from 'vitest';
import { readConversionReport } from '../conversion-report';

const counted: Record<string, unknown> = { part: 'word/document.xml', what: 'image type GIF not rendered', count: 1, severity: 'minor', label: 'Image not shown' };
const macros: Record<string, unknown> = { part: 'word/vbaProject.bin', bytes: 12800, severity: 'info', label: 'Macros removed' };

describe('a conversion report', () => {
  it('reads both kinds of loss with their severity and label', () => {
    expect(readConversionReport({ losses: [counted, macros] }, []).losses).toEqual([
      { kind: 'counted', part: 'word/document.xml', what: 'image type GIF not rendered', count: 1, severity: 'minor', label: 'Image not shown' },
      { kind: 'macros', part: 'word/vbaProject.bin', bytes: 12800n, severity: 'info', label: 'Macros removed' },
    ]);
  });

  it('refuses a loss without a severity, or with one it does not know', () => {
    const { severity: _dropped, ...bare } = counted;
    expect(() => readConversionReport({ losses: [bare] }, [])).toThrow(/loss 0 has no severity/);
    expect(() => readConversionReport({ losses: [{ ...counted, severity: 'fatal' }] }, [])).toThrow(/loss 0 has no severity/);
  });

  it('refuses a loss without a label', () => {
    expect(() => readConversionReport({ losses: [macros, { ...counted, label: 3 }] }, [])).toThrow(/loss 1 has no label/);
  });
});
