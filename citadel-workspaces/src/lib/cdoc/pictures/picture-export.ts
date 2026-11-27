/**
 * Which exports carry picture bytes: a DOCX or ODT package embeds every picture (the engine
 * refuses to write one without them), a PDF draws a missing picture as a box, Markdown and plain
 * text carry no pictures. An export of a package with a picture that could not be fetched is
 * refused with why, rather than failing on the engine's message or leaving the picture out.
 */
import type { ExportFormat } from '../editor/file-formats';

const EMBEDDING: ReadonlySet<ExportFormat> = new Set<ExportFormat>(['docx', 'dotx', 'odt']);

export const embedsPictures = (format: ExportFormat): boolean => EMBEDDING.has(format);

/** What the member is told: `labels` are the boxes' labels, one per picture not at hand. */
export function picturesAbsent(labels: readonly string[]): string {
  const why: string = [...new Set(labels)].map((label: string): string => label.replace(/^picture not available: ?/, '')).filter((w: string): boolean => w !== '').join('; ');
  const count: string = labels.length === 1 ? '1 picture' : `${labels.length} pictures`;
  return `The document was not exported: ${count} could not be fetched${why === '' ? '' : ` (${why})`}. Try again once they show in the document.`;
}
