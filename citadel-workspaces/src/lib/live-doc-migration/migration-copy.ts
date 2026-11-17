/** What the chat-document migration says to the person, in one place: the banner, the original, conflicts. */

/** The loss report's heading, in ConversionReportPanel's "<what was converted>: <summary>" form. */
export const MIGRATION_REPORT_TITLE: string = 'Moved to the new document editor';

export const SHOW_ORIGINAL: string = 'Show original';
export const HIDE_ORIGINAL: string = 'Hide original';

/** Above the original: what it is and how long it is kept. */
export const ORIGINAL_NOTE: string = 'The document as it was before the move. It is kept read-only on this device for one release.';

/** When the new editor cannot lay the original out: its text is shown instead. */
export const ORIGINAL_AS_TEXT_NOTE: string = 'The new editor could not show the original’s formatting here, so this is its text.';

export const ORIGINAL_OPENING: string = 'Opening the original\u2026';
export const ORIGINAL_UNOPENED: string = 'The original could not be opened.';
export const ORIGINAL_GONE: string = 'The original is no longer on this device.';

export const DOWNLOAD_ORIGINAL_TEXT: string = 'Download as .txt';

/** The lost-edits entry in the loss report (conflict-record.ts). */
export const LOST_EDITS_LABEL: string = 'Not in the shared copy';
export const LOST_EDITS_PART: string = 'this device';
export const LOST_EDITS_WHAT: string = 'edits made here before the document’s creator moved it; they are kept in a conflicted copy';

/** Said under the report when this device's migration differs from a peer's. */
export const CONFLICT_NOTES: { readonly [K in 'creator-keeps' | 'adopt-creator' | 'await-creator' | 'held-apart']: string } = {
  'creator-keeps': 'The other person moved a different version of this document, so the two copies are kept apart. Yours stays the document, because you created it; changes are not exchanged with theirs.',
  'adopt-creator': 'The document’s creator moved a different version. Theirs is now the shared one; yours is kept as a read-only conflicted copy.',
  'await-creator': 'The other person moved a different version of this document. Both are kept until its creator’s version arrives.',
  'held-apart': 'The document’s creator moved a different version of it, so the two copies are kept apart and changes are not exchanged. Theirs is the document; this version of the app cannot bring it over, so the copy here is yours alone.',
};

/** A file name for the original's text, from its title. */
export function originalTextFileName(title: string): string {
  const printable: string = Array.from(title, (ch: string): string => ((ch.codePointAt(0) ?? 0) < 0x20 ? ' ' : ch)).join('');
  const safe: string = printable.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${safe || 'Document'} (original).txt`;
}
