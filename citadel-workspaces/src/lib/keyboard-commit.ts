/**
 * Does this keypress mean "commit what I typed"?
 *
 * The clause that is easy to omit and impossible to notice without an IME:
 * while a candidate window is open, Enter CONFIRMS the composition — it is not
 * a commit. Without the `isComposing` check, a user typing Japanese, Chinese or
 * Korean commits a half-composed value every time they choose a character, and
 * for a rename or a document title that means the wrong name is saved and has
 * to be corrected by hand.
 *
 * Native `<form>` submission already suppresses Enter during composition, so
 * only the places that handle the key themselves need this. The chat composer
 * had it; the rename input, the path bar and the document-title modal each
 * handled Enter themselves and each went without.
 *
 * The shift rule is deliberately NOT part of this. A multi-line composer treats
 * Shift+Enter as a newline; a single-line rename field has no newline to
 * insert. Callers that want the distinction say so.
 */
export function isEnterCommit(event: {
  key: string;
  nativeEvent: { isComposing: boolean };
}): boolean {
  if (event.nativeEvent.isComposing) return false;
  return event.key === 'Enter';
}
