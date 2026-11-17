/**
 * The Customer Terms version a person accepts when they create a workspace, sent as
 * `accepted_customer_terms_version`. The control plane refuses any other. The text is bundled
 * (legal-documents.ts); legal-documents-parity.test.ts holds this to the crate's
 * CUSTOMER_TERMS_VERSION and to the version the text states.
 */
export const SHOWN_CUSTOMER_TERMS_VERSION: number = 1;
