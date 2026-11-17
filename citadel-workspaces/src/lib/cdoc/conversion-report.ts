/**
 * What a conversion to or from another format could not carry: cdoc-model's Report, read from
 * the engine's JSON. Every importer and exporter returns one and the UI shows every entry; a
 * report this side cannot read is an error, never an empty report.
 *
 * A loss is either counted (`{part, what, count}`) or refused macros (`{part, bytes}`), told
 * apart by their fields exactly as citadel-docs serialises cdoc_model::Loss (untagged); each
 * carries its `severity` and `label` (docs/loss-report.md).
 */
import type { ConversionLoss, ConversionReport, LossSeverity } from './editor/file-formats';

export class ConversionReportError extends Error {
  constructor(message: string) {
    super(`unreadable conversion report: ${message}`);
    this.name = 'ConversionReportError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const SEVERITIES: readonly LossSeverity[] = ['info', 'minor', 'major'];
const isSeverity = (value: unknown): value is LossSeverity => SEVERITIES.some((s: LossSeverity): boolean => s === value);

function lossOf(value: unknown, index: number): ConversionLoss {
  if (!isRecord(value) || typeof value.part !== 'string') throw new ConversionReportError(`loss ${index} has no part`);
  const { severity, label } = value;
  if (!isSeverity(severity)) throw new ConversionReportError(`loss ${index} has no severity`);
  if (typeof label !== 'string') throw new ConversionReportError(`loss ${index} has no label`);
  if (typeof value.what === 'string' && typeof value.count === 'number' && Number.isInteger(value.count)) {
    return { kind: 'counted', part: value.part, what: value.what, count: value.count, severity, label };
  }
  if (typeof value.bytes === 'number' && Number.isInteger(value.bytes) && value.bytes >= 0) {
    return { kind: 'macros', part: value.part, bytes: BigInt(value.bytes), severity, label };
  }
  throw new ConversionReportError(`loss ${index} is neither counted nor refused macros`);
}

/** `report` is the engine's `{losses: [...]}`; `problems` its array of strings. */
export function readConversionReport(report: unknown, problems: unknown): ConversionReport {
  if (!isRecord(report) || !Array.isArray(report.losses)) throw new ConversionReportError('no losses array');
  if (!Array.isArray(problems) || !problems.every((p: unknown): p is string => typeof p === 'string')) {
    throw new ConversionReportError('problems is not an array of strings');
  }
  return { losses: report.losses.map(lossOf), problems };
}

export function refusedMacros(report: ConversionReport): Array<Extract<ConversionLoss, { kind: 'macros' }>> {
  return report.losses.filter((l: ConversionLoss): l is Extract<ConversionLoss, { kind: 'macros' }> => l.kind === 'macros');
}

export function isLossless(report: ConversionReport): boolean {
  return report.losses.length === 0 && report.problems.length === 0;
}
