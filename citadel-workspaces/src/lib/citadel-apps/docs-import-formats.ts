/**
 * The file formats Citadel Docs opens. Each id is also the file's extension, which is how the
 * registry lists them. Kept apart from docs-file-kinds (routing, MIME types, labels) because
 * the registry is on the landing page's critical path and needs only this list.
 */
export const DOCS_IMPORT_FORMATS = ['docx', 'dotx', 'odt', 'md', 'txt'] as const;
export type DocsImportFormat = (typeof DOCS_IMPORT_FORMATS)[number];
