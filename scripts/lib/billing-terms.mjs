/**
 * The two documents that render billing/policy.json, and their rendering: shared by
 * scripts/render-billing-terms.mjs (writes) and scripts/check-billing-terms-render.mjs (compares),
 * so the check cannot render differently from the renderer. I/O is the caller's: `read` takes a
 * repository-relative path and returns its text.
 */
import { applyBlocks, applyEffectiveDate } from './billing-terms-blocks.mjs';
import { billingTermsBlocks } from './billing-terms-wording.mjs';

export const POLICY_FILE = 'billing/policy.json';
export const DOCUMENTS = Object.freeze({
  customer: 'citadel-workspace-types/src/customer_terms.md',
  platform: 'citadel-workspace-types/src/platform_terms.md',
});

/** `[{path, before, after, blocks}]`: each document as it is and as policy.json renders it. */
export function renderBillingTerms(read) {
  let policy;
  try {
    policy = JSON.parse(read(POLICY_FILE));
  } catch (error) {
    throw new Error(`${POLICY_FILE} is not readable JSON: ${error.message}`);
  }
  const { effective, ...blocks } = billingTermsBlocks(policy);
  return Object.entries(DOCUMENTS).map(([doc, path]) => {
    const before = read(path);
    const after = applyEffectiveDate(applyBlocks(before, blocks[doc], path), effective, path);
    return { path, before, after, blocks: Object.keys(blocks[doc]).length };
  });
}
