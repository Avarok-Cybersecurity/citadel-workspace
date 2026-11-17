import type { CurrentTerms } from 'citadel-workspace-client-ts';
import type { TermsText } from '@/components/TermsDialog';

/** The documents of `terms` in reading order: the platform's, then the workspace's if it has any. */
export function termsTexts(terms: CurrentTerms): TermsText[] {
  const documents: TermsText[] = [{ heading: 'Platform terms', version: terms.platform.version, text: terms.platform.text, markdown: true }];
  if (terms.workspace !== null) documents.push({ heading: 'Workspace terms', version: terms.workspace.version, text: terms.workspace.text });
  return documents;
}
