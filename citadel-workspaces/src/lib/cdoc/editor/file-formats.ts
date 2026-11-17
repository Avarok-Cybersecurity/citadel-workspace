/**
 * Opening a replica from a file and exporting the live document. The engine side (cdoc-edit's
 * EditorHandle importing and exporting through the format crates) is the cdoc-edit-io release;
 * until it is vendored both fail by name rather than pretending.
 */

/** A file a replica can be opened from, by its kind (never by its extension or MIME type alone). */
export type ImportFormat = 'docx' | 'odt' | 'md' | 'txt';
export type ExportFormat = 'docx' | 'dotx' | 'odt' | 'md' | 'txt' | 'pdf';

/**
 * How much a loss matters (citadel-docs docs/loss-report.md): `info` changes nothing a reader
 * sees, `minor` approximates formatting, layout or structure, `major` loses visible content.
 */
export type LossSeverity = 'info' | 'minor' | 'major';

interface LossTier {
  readonly severity: LossSeverity;
  /** Plain language, for the user; `what` names the element. */
  readonly label: string;
}

/**
 * One loss, as the model's report spells it (cdoc_model::Loss, untagged on the wire, tagged
 * here): a counted loss, or refused macros, each with its severity and label.
 */
export type ConversionLoss =
  | (LossTier & { readonly kind: 'counted'; readonly part: string; readonly what: string; readonly count: number })
  | (LossTier & { readonly kind: 'macros'; readonly part: string; readonly bytes: bigint });

/** What a conversion could not carry; every importer and exporter returns one. */
export interface ConversionReport {
  readonly losses: readonly ConversionLoss[];
  /** The model's validation problems with an imported document. */
  readonly problems: readonly string[];
}

/** PDF records when it was written, so its target carries the time; no other format does. */
export type ExportTarget =
  | { readonly format: 'pdf'; readonly nowRfc3339: string }
  | { readonly format: Exclude<ExportFormat, 'pdf'> };

export interface ExportedFile {
  /** A buffer of its own, transferable. */
  readonly bytes: Uint8Array;
  /** What the file could not carry; null for a PDF, whose writer reports no losses yet. */
  readonly report: ConversionReport | null;
}

/** What an import could not carry, and whether the file was a document or a template. */
export interface ImportReport extends ConversionReport {
  readonly format: ImportFormat;
  /** DOCX and ODT only: a template (.dotx, .ott) opens as a new document from it. */
  readonly kind: 'document' | 'template' | null;
}
