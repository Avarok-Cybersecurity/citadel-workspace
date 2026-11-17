/**
 * A chat document's title: the check every title passes before it is used (the composer's
 * dialog, a rename, a peer's title stamp), and the title an earlier editor's document carries
 * in its Yjs state (`getMap('cdoc')`, key `title`), read once when it is moved to Citadel Docs.
 */

import type * as Y from 'yjs';

export const DOC_ATTRIBUTES_MAP: 'cdoc' = 'cdoc';
export const DOC_TITLE_KEY: 'title' = 'title';
export const DOC_TITLE_MAX_LENGTH: 80 = 80;

export type TitleCheck = { ok: true; title: string } | { ok: false; reason: string };

/** Collapse whitespace runs (newlines, tabs) so a title is always one line. */
function normalise(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function validateDocTitle(raw: string): TitleCheck {
  const title: string = normalise(raw);
  if (!title) return { ok: false, reason: 'Enter a title for the document.' };
  if (title.length > DOC_TITLE_MAX_LENGTH) {
    return { ok: false, reason: `Keep the title to ${DOC_TITLE_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, title };
}

function attributes(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(DOC_ATTRIBUTES_MAP);
}

/**
 * The title a document carries, or null when it has none or what it carries is
 * unusable. A peer wrote this value, so it is re-checked here: a non-string or
 * blank is ignored, and an over-long one is cut rather than trusted.
 */
export function readDocTitle(doc: Y.Doc): string | null {
  const raw: unknown = attributes(doc).get(DOC_TITLE_KEY);
  if (typeof raw !== 'string') return null;
  const title: string = normalise(raw).slice(0, DOC_TITLE_MAX_LENGTH).trim();
  return title || null;
}
