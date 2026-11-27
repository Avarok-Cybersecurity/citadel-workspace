/**
 * A chat document's title: the check every title passes before it is used (the composer's
 * dialog, a rename, a peer's title stamp).
 */

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
