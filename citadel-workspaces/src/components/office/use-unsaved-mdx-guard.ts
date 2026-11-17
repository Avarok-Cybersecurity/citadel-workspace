import { useEffect, useRef , type MutableRefObject } from 'react';
import { registerUnsavedEdits } from '@/lib/unsaved-edits';

/**
 * Protects an in-progress MDX edit from being thrown away without a word.
 *
 * The editor buffer is plain component state. Cancel was a bare toggle, and the
 * workspace view is keyed by node id — so clicking any other node in the
 * sidebar unmounted the editor and the buffer with it, mid-edit, silently.
 * Closing the browser tab did the same. Twenty minutes of writing could go with
 * one stray click and no prompt anywhere.
 *
 * The baseline is captured when editing BEGINS rather than compared against the
 * stored document, because the two differ legitimately: a node with no content
 * yet opens with a template, which the user has not written and must not be
 * warned about.
 */
export function useUnsavedMdxGuard({
  isEditing,
  content,
  ownerId,
}: {
  isEditing: boolean;
  content: string;
  /** Identifies this editor in the shared unsaved-edits set. */
  ownerId: string;
}): { isDirty: boolean } {
  const baselineRef: MutableRefObject<string | null> = useRef<string | null>(null);

  // Captured once per editing session. `content` is in the dependency list
  // because the first render of an editing session needs it, but the null check
  // is what stops every keystroke from re-baselining — which would make the
  // buffer permanently "clean" and the guard permanently silent.
  useEffect(() => {
    if (!isEditing) {
      baselineRef.current = null;
      return;
    }
    if (baselineRef.current === null) baselineRef.current = content;
  }, [isEditing, content]);

  const isDirty: boolean =
    isEditing && baselineRef.current !== null && content !== baselineRef.current;

  // Published so in-app navigation can ask, not just the browser. See
  // `lib/unsaved-edits` for why this is a store rather than a router blocker.
  useEffect(() => {
    if (!isDirty) return;
    return registerUnsavedEdits(ownerId);
  }, [isDirty, ownerId]);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      // Both are required: browsers disagree about which one arms the prompt,
      // and the prompt itself is the only protection against a closed tab.
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return (): void => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  return { isDirty };
}

/** The wording used for the Cancel prompt and the navigation guard. */
// Re-exported so existing importers keep working; the constant itself lives in
// a leaf module, because a navigation source asking "may I leave" should not
// have to import an office hook to find the sentence.
export { DISCARD_EDIT_PROMPT } from '@/lib/unsaved-edits-prompt';
