/**
 * What the loss banner shows for a migrated chat document: the mapper's report, read whole by
 * conversion-report.ts (a report this side cannot read is an error, never an empty one), plus
 * the conflict's lost edits; and the original, as Citadel Docs' JSON when the mapper can make
 * it, always as text.
 */
import { readConversionReport } from '@/lib/cdoc/conversion-report';
import type { ConversionReport } from '@/lib/cdoc/editor/file-formats';
import { conflictLosses, type ConflictRecord } from './conflict-record';
import type { MigrationMarker } from './marker';
import type { MigrationMapper } from './mapper-port';
import { plainTextOf } from './pm-json';
import type { WalkedDocument } from './yjs-walker';

export function migrationReport(marker: MigrationMarker, conflict: ConflictRecord | null): ConversionReport {
  const { report, problems } = JSON.parse(marker.reportJson) as { report: unknown; problems: unknown };
  const mapped: ConversionReport = readConversionReport(report, problems);
  return conflict === null ? mapped : { losses: [...mapped.losses, ...conflictLosses(conflict)], problems: mapped.problems };
}

/** The original, as "Show original" renders it. */
export interface OriginalDocument {
  readonly title: string;
  /** Citadel Docs' ProseMirror JSON for the static `pm` source; null when the mapper could not make it. */
  readonly docsPm: string | null;
  /** Its text, block per line: the fallback view and the .txt download. */
  readonly text: string;
}

export function originalDocument(walked: WalkedDocument, fallbackTitle: string, mapper: MigrationMapper | null): OriginalDocument {
  let docsPm: string | null = null;
  if (mapper !== null) {
    try {
      docsPm = mapper.toDocsPm(JSON.stringify(walked.pm));
    } catch {
      // Not swallowed: a null docsPm is the reported fallback, which the view says out loud
      // (ORIGINAL_AS_TEXT_NOTE) and which still shows every word as text.
      docsPm = null;
    }
  }
  return { title: walked.title ?? fallbackTitle, docsPm, text: plainTextOf(walked.pm) };
}
