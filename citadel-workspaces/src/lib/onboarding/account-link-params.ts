/**
 * The query parameters an account link uses, and whether a URL carries one.
 *
 * Kept apart from account-link.ts so the landing page can tell whether to act on a
 * link without loading the parser, its validators and the switch flow: those are
 * imported only when a link is present (use-account-link.ts), which keeps them off
 * the landing page's critical path (scripts/check-bundle-budget.mjs).
 */
export const ACCOUNT_LINK_PARAMS: readonly ['account', 'server', 'link', 'open'] = ['account', 'server', 'link', 'open'];

/** True when the URL carries any of the link's parameters, valid or not. */
export function hasAccountLinkParams(params: URLSearchParams): boolean {
  return ACCOUNT_LINK_PARAMS.some((key: string) => params.has(key));
}
