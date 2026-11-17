/**
 * The bundled legal documents are the crate's. Reads the Rust crate's texts and versions straight
 * from the parent checkout (CI runs from the parent). Standalone submodule checkouts have no parent
 * to compare with, so only there is the comparison skipped.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUSTOMER_TERMS_DOCUMENT, LEGAL_DOCUMENTS, PLATFORM_TERMS_DOCUMENT, type LegalDocument, type LegalDocumentId } from '../legal-documents';
import { SHOWN_PLATFORM_TERMS_VERSION } from '../platform-terms';
import { SHOWN_CUSTOMER_TERMS_VERSION } from '../customer-terms';

const TYPES: string = join(process.cwd(), '..', 'citadel-workspace-types', 'src');
const present: boolean = existsSync(join(TYPES, 'terms.rs'));

const CRATE_FILE: Readonly<Record<LegalDocumentId, string>> = {
  terms: 'platform_terms.md',
  'customer-terms': 'customer_terms.md',
  privacy: 'privacy_notice.md',
  dpa: 'dpa.md',
  subprocessors: 'subprocessors.md',
};

function crateVersion(constant: string): number {
  const rust: string = readFileSync(join(TYPES, 'terms.rs'), 'utf8');
  const version: RegExpMatchArray | null = rust.match(new RegExp(`${constant}: u32 = (\\d+);`));
  expect(version).not.toBeNull();
  return Number(version?.[1]);
}

/** Each document's effective date: the terms and the notice changed for browser console logs. */
const EFFECTIVE: Readonly<Record<LegalDocumentId, string>> = {
  terms: 'October 23, 2026',
  'customer-terms': 'October 14, 2026',
  privacy: 'October 23, 2026',
  dpa: 'October 14, 2026',
  subprocessors: 'October 14, 2026',
};

describe.each(LEGAL_DOCUMENTS.map((doc: LegalDocument): [LegalDocumentId, LegalDocument] => [doc.id, doc]))('the bundled %s', (id: LegalDocumentId, doc: LegalDocument) => {
  it.skipIf(!present)("is the crate's text, byte for byte", () => {
    expect(doc.text).toBe(readFileSync(join(TYPES, CRATE_FILE[id]), 'utf8'));
  });
  it('states its own title and effective date', () => {
    expect(doc.title).toMatch(/^Citadel Workspace /);
    expect(doc.effective).toBe(EFFECTIVE[id]);
  });
});

describe('the versions the UI sends and shows', () => {
  it.skipIf(!present)("platform terms name the crate's version", () => {
    expect(SHOWN_PLATFORM_TERMS_VERSION).toBe(crateVersion('PLATFORM_TERMS_VERSION'));
  });
  it.skipIf(!present)("customer terms name the crate's version", () => {
    expect(SHOWN_CUSTOMER_TERMS_VERSION).toBe(crateVersion('CUSTOMER_TERMS_VERSION'));
  });
  it('are the versions the texts themselves state', () => {
    expect(PLATFORM_TERMS_DOCUMENT.version).toBe(SHOWN_PLATFORM_TERMS_VERSION);
    expect(CUSTOMER_TERMS_DOCUMENT.version).toBe(SHOWN_CUSTOMER_TERMS_VERSION);
  });
});
