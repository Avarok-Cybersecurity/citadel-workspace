/**
 * What the Link dialog may hand the engine. A document link is clicked later by someone else,
 * so only the schemes the page view will honour are accepted (`allowedLink`, the painter's
 * copy of cdoc_paint's rule): `javascript:`, `data:` and the like would run in, or
 * impersonate, whoever opens the document (CWE-79 class). A bare host ("example.com") is read
 * as https, as Word does.
 */
import { allowedLink } from '@/lib/cdoc/paint/page-painter';

export type LinkTarget = { readonly ok: true; readonly href: string } | { readonly ok: false; readonly reason: string };

/** A scheme, not a host and port ("example.com:8080" has none). */
const HAS_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/** What comes between `scheme://` and the path: where a space cannot belong. */
function hostOf(candidate: string): string {
  return candidate.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, '').split(/[/?#]/)[0];
}

export function linkTarget(input: string): LinkTarget {
  const trimmed: string = input.trim();
  if (trimmed === '') return { ok: false, reason: 'Enter an address to link to.' };
  const candidate: string = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  // Engines differ here: Chromium encodes "not a url" into a dead https://not%20a%20url/.
  if (/\s/.test(hostOf(candidate))) return { ok: false, reason: 'A web address cannot have spaces in its name.' };
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    // A URL that does not parse is the answer itself, not an error to report: say why plainly.
    return { ok: false, reason: 'That is not an address a link can open.' };
  }
  if (!allowedLink(url.href)) {
    return { ok: false, reason: `Links may open web or mail addresses, not ${url.protocol} ones.` };
  }
  if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname === '') {
    return { ok: false, reason: 'That address has no host.' };
  }
  return { ok: true, href: url.href };
}
