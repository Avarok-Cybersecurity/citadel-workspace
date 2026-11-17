/**
 * Whether the document has the keyboard, and whether it got it from the keyboard: the caret
 * blinks only while focused, and the region shows a focus ring only for keyboard users (a
 * press on the page focuses it too, and Word draws no ring for that). The modality is the last
 * input before focus arrived, as :focus-visible decides it for ordinary controls.
 */
import { useEffect, useState, type RefObject } from 'react';

export interface EditorFocus {
  readonly focused: boolean;
  readonly focusRing: boolean;
}

export function useEditorFocus(input: RefObject<HTMLTextAreaElement>): EditorFocus {
  const [focus, setFocus] = useState<EditorFocus>({ focused: false, focusRing: false });

  useEffect((): (() => void) | undefined => {
    const el: HTMLTextAreaElement | null = input.current;
    if (el === null) return undefined;
    const doc: Document = el.ownerDocument;
    let byKeyboard: boolean = false;
    const onKey = (): void => { byKeyboard = true; };
    const onPointer = (): void => {
      byKeyboard = false;
      setFocus((f: EditorFocus): EditorFocus => (f.focusRing ? { focused: f.focused, focusRing: false } : f));
    };
    const onFocus = (): void => setFocus({ focused: true, focusRing: byKeyboard });
    const onBlur = (): void => setFocus({ focused: false, focusRing: false });
    if (doc.activeElement === el) onFocus();
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('pointerdown', onPointer, true);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    return (): void => {
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('pointerdown', onPointer, true);
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
    };
  }, [input]);

  return focus;
}
