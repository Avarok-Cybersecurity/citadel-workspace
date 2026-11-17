/**
 * The open document's own paragraph styles (EditorController.styles(), each as it resolves),
 * read when the editor opens and again each time `refresh` changes (the gallery opening), so
 * an imported document's styles, and any it gains, are the ones offered.
 */
import { useEffect, useState } from 'react';
import type { DocumentStyle } from '@/lib/cdoc/editor/controller';
import { describeError } from '@/lib/describe-error';
import type { RibbonEditor } from './editor-context';

export type DocumentStyles =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly styles: readonly DocumentStyle[] }
  | { readonly kind: 'failed'; readonly message: string };

/** Word shows a built-in's stored name capitalised ("heading 1" is "Heading 1"). */
export function styleDisplayName(style: DocumentStyle): string {
  return style.name.charAt(0).toUpperCase() + style.name.slice(1);
}

export function useDocumentStyles(editor: RibbonEditor | null, refresh: number): DocumentStyles {
  const [styles, setStyles] = useState<DocumentStyles>({ kind: 'loading' });
  useEffect((): (() => void) => {
    let live: boolean = true;
    if (editor === null) return (): void => undefined;
    editor.styles().then(
      (all: DocumentStyle[]): void => {
        if (live) setStyles({ kind: 'ready', styles: all.filter((s: DocumentStyle): boolean => s.kind === 'paragraph') });
      },
      (error: unknown): void => {
        if (live) setStyles({ kind: 'failed', message: `The document’s styles could not be read. ${describeError(error)}` });
      },
    );
    return (): void => { live = false; };
  }, [editor, refresh]);
  return styles;
}
