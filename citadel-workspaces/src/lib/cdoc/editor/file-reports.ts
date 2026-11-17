/**
 * The engine's file reports, read whole: fromDocument's `{"report", "problems", "kind"}` and
 * export's `{"losses": [...]}` (docs/edit-commands.md § Files). A report this side cannot read
 * is an error, never an empty one.
 */
import { ConversionReportError, readConversionReport } from '../conversion-report';
import type { ConversionReport, ImportFormat, ImportReport } from './file-formats';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parsed(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value)) throw new ConversionReportError('not an object');
  return value;
}

export function readImportReport(json: string, format: ImportFormat): ImportReport {
  const value: Record<string, unknown> = parsed(json);
  const report: ConversionReport = readConversionReport(value.report, value.problems);
  const kind: unknown = value.kind;
  if (kind !== 'document' && kind !== 'template' && kind !== null && kind !== undefined) throw new ConversionReportError(`kind ${String(kind)}`);
  return { format, kind: kind ?? null, ...report };
}

/** An export's losses; an export reports no validation problems. */
export function readExportReport(json: string): ConversionReport {
  return readConversionReport(parsed(json), []);
}
