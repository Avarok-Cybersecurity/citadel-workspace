/**
 * The five legal documents by name and page, without their texts. The landing page links to
 * them before anything else has loaded, and the texts (legal-documents.ts) are too large to
 * download on that path.
 */
export type LegalDocumentId = 'terms' | 'customer-terms' | 'privacy' | 'dpa' | 'subprocessors';

/** In the order the index lists them. */
export const LEGAL_DOCUMENT_IDS: readonly LegalDocumentId[] = ['terms', 'customer-terms', 'privacy', 'dpa', 'subprocessors'];

/** Short names for links, footers and tab titles; the documents' own titles are long. */
export const LEGAL_SHORT_NAME: Readonly<Record<LegalDocumentId, string>> = {
  terms: 'Terms of Use',
  'customer-terms': 'Customer Terms',
  privacy: 'Privacy Notice',
  dpa: 'Data Processing Addendum',
  subprocessors: 'Subprocessors',
};

/** The public page, which the documents themselves link to under https://work.avarok.net. */
export function legalPath(id: LegalDocumentId): string {
  return `/legal/${id}`;
}
