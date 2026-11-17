/**
 * The file formats Citadel Docs opens and writes, and how a file is routed to it: the one table
 * the file manager, the registry's extension list and the engine's codec all read. Pure and
 * cdoc-free, so the shell can route a file without loading the engine.
 *
 * Routing: a file whose record names a Citadel App opens in that app (a Docs-tagged file still
 * needs a format Docs reads); a file with no app record is routed by its extension, then by its
 * MIME type. Macro-enabled Word files are refused by name: Docs never runs or carries macros.
 */
import type { CitadelAppId } from './registry';
import type { ExportFormat } from '../cdoc/editor/file-formats';

import { DOCS_IMPORT_FORMATS, type DocsImportFormat } from './docs-import-formats';

export { DOCS_IMPORT_FORMATS, type DocsImportFormat };

/** Every format the engine writes, in menu order. */
export const DOCS_EXPORT_FORMATS: readonly ExportFormat[] = ['docx', 'dotx', 'odt', 'md', 'txt', 'pdf'];

export interface DocsFormatInfo {
  readonly extension: string;
  readonly mime: string;
  /** What the format is called in a menu. */
  readonly label: string;
}

/** A format's extension is its id (see docs-import-formats). */
export const DOCS_FORMATS: { readonly [F in ExportFormat]: DocsFormatInfo } = {
  docx: { extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word document (.docx)' },
  dotx: { extension: 'dotx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template', label: 'Word template (.dotx)' },
  odt: { extension: 'odt', mime: 'application/vnd.oasis.opendocument.text', label: 'OpenDocument text (.odt)' },
  md: { extension: 'md', mime: 'text/markdown', label: 'Markdown (.md)' },
  txt: { extension: 'txt', mime: 'text/plain', label: 'Plain text (.txt)' },
  pdf: { extension: 'pdf', mime: 'application/pdf', label: 'PDF (.pdf)' },
};

const MACRO_ENABLED: ReadonlySet<string> = new Set<string>(['docm', 'dotm']);
const MACRO_MIMES: ReadonlySet<string> = new Set<string>([
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.template.macroenabledtemplate.12',
]);

export type DocsFileRoute =
  | { readonly kind: 'docs'; readonly format: DocsImportFormat }
  /** A macro-enabled Word file: refused, never opened as a Docs document. */
  | { readonly kind: 'macro-enabled' }
  | { readonly kind: 'unsupported'; readonly reason: string };

export interface RoutableFile {
  readonly name: string;
  /** The MIME type the file was stored with; empty when none was recorded. */
  readonly mime: string;
  /** The Citadel App the file's record names, or null when it names none. */
  readonly app: CitadelAppId | null;
}

function extensionOf(name: string): string {
  const dot: number = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

const isImportFormat = (value: string): value is DocsImportFormat => (DOCS_IMPORT_FORMATS as readonly string[]).includes(value);

function formatOf(extension: string, mime: string): DocsImportFormat | null {
  if (isImportFormat(extension)) return extension;
  const byMime: DocsImportFormat | undefined = DOCS_IMPORT_FORMATS.find((f: DocsImportFormat): boolean => DOCS_FORMATS[f].mime === mime);
  return byMime ?? null;
}

export function docsFileRoute(file: RoutableFile): DocsFileRoute {
  const extension: string = extensionOf(file.name);
  const mime: string = file.mime.toLowerCase();
  if (MACRO_ENABLED.has(extension) || MACRO_MIMES.has(mime)) return { kind: 'macro-enabled' };
  if (file.app !== null && file.app !== 'docs') return { kind: 'unsupported', reason: `It belongs to another Citadel App (${file.app}).` };
  const format: DocsImportFormat | null = formatOf(extension, mime);
  if (format !== null) return { kind: 'docs', format };
  const named: string = extension === '' ? 'a file with no extension' : `a .${extension} file`;
  return { kind: 'unsupported', reason: `Citadel Docs opens .docx, .dotx, .odt, .md and .txt files; this is ${named}.` };
}

/** `title` without a Docs extension it already carries, plus `format`'s extension. */
export function exportFileName(title: string, format: ExportFormat): string {
  const extension: string = extensionOf(title);
  const known: boolean = (DOCS_EXPORT_FORMATS as readonly string[]).includes(extension);
  const stem: string = known ? title.slice(0, title.length - extension.length - 1) : title;
  return `${stem}.${DOCS_FORMATS[format].extension}`;
}
