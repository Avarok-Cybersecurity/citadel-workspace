/**
 * What a document view opens. Types and pure mappings only, so the shell can name it without
 * loading cdoc.
 * The document-content work item adds the node's stored content as a source.
 */
import type { DocsImportFormat } from '../citadel-apps/docs-file-kinds';
import type { EditorOrigin } from './editor/controller';
import type { ImportFormat } from './editor/file-formats';

export type DocumentSource =
  | { readonly kind: 'blank' }
  | { readonly kind: 'pm'; readonly pmJson: string }
  | { readonly kind: 'model'; readonly modelJson: string }
  /** A file's bytes, opened as a replica by `format` (EditorHandle.fromDocument). */
  | { readonly kind: 'file'; readonly format: DocsImportFormat; readonly bytes: Uint8Array };

/** A source the engine lays out once, read-only, with no replica: Docs' own JSON. */
export type StaticSource = Extract<DocumentSource, { readonly kind: 'pm' | 'model' }>;

export const isStaticSource = (source: DocumentSource): source is StaticSource => source.kind === 'pm' || source.kind === 'model';

/** A source that opens as a replica: a new blank document, or a file. */
export type ReplicaSource = Exclude<DocumentSource, StaticSource>;

/** DOCX and DOTX share the package reader, whose report says which the file was. */
const READER: { readonly [F in DocsImportFormat]: ImportFormat } = { docx: 'docx', dotx: 'docx', odt: 'odt', md: 'md', txt: 'txt' };

/** What a replica of `source` opens from. The bytes are copied: they move to the worker, and the caller's stay usable for a reopen. */
export function replicaOrigin(source: ReplicaSource): EditorOrigin {
  return source.kind === 'blank' ? { kind: 'blank' } : { kind: 'bytes', bytes: source.bytes.slice(), format: READER[source.format] };
}
