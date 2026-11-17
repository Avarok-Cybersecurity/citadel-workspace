/**
 * The engine's loss report, read: counted losses and refused macros (citadel-docs' untagged
 * cdoc_model::Loss, the macro shape as the kind-aware importer writes it), problems kept, and a
 * report this side cannot read is an error, never an empty report. Pure data; no mocks.
 */
import { describe, expect, it } from 'vitest';
import { ConversionReportError, isLossless, readConversionReport, refusedMacros } from '../conversion-report';
import type { ConversionReport } from '../editor/file-formats';

/** A valid severity and label, so each refusal below is for the reason it names. */
const TIER: { readonly severity: 'info'; readonly label: string } = { severity: 'info', label: 'x' };

describe('reading a conversion report', () => {
  it('reads counted losses and refused macros, macro sizes as bigint', () => {
    const report: ConversionReport = readConversionReport(
      {
        losses: [
          { part: 'word/document.xml', what: 'w:rPr/w:spacing', count: 18, severity: 'minor', label: 'Character spacing simplified' },
          { part: 'word/vbaProject.bin', bytes: 11264, severity: 'info', label: 'Macros removed' },
        ],
      },
      ['a style names a missing base'],
    );
    expect(report.losses).toEqual([
      { kind: 'counted', part: 'word/document.xml', what: 'w:rPr/w:spacing', count: 18, severity: 'minor', label: 'Character spacing simplified' },
      { kind: 'macros', part: 'word/vbaProject.bin', bytes: 11264n, severity: 'info', label: 'Macros removed' },
    ]);
    expect(refusedMacros(report)).toEqual([{ kind: 'macros', part: 'word/vbaProject.bin', bytes: 11264n, severity: 'info', label: 'Macros removed' }]);
    expect(isLossless(report)).toBe(false);
  });

  it('is lossless only with no losses and no problems', () => {
    expect(isLossless(readConversionReport({ losses: [] }, []))).toBe(true);
    expect(isLossless(readConversionReport({ losses: [] }, ['x']))).toBe(false);
  });

  it.each([
    ['no losses array', {}, []],
    ['a loss without a part', { losses: [{ what: 'x', count: 1, ...TIER }] }, []],
    ['a loss of neither shape', { losses: [{ part: 'p', count: 1, ...TIER }] }, []],
    ['a negative macro size', { losses: [{ part: 'p', bytes: -1, ...TIER }] }, []],
    ['problems that are not strings', { losses: [] }, [1]],
  ])('refuses %s', (_name: string, report: unknown, problems: unknown) => {
    expect(() => readConversionReport(report, problems)).toThrow(ConversionReportError);
  });
});
