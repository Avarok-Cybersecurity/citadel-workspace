/**
 * "Hyphenation for German applies after reopening": an edit (local or a peer's) brought in a
 * language the replica was opened without patterns for. Checked once the document has been idle
 * for `idleMs`, and each language is named once per replica. R1 does not reopen by itself.
 */
import { useEffect, useState } from 'react';
import type { EditorController } from '@/lib/cdoc/editor/controller';

/** Runs `task` after `ms`; the returned function cancels it. */
export type Delay = (ms: number, task: () => void) => () => void;

const names: Intl.DisplayNames = new Intl.DisplayNames(['en'], { type: 'language' });

/** A pattern tag's language as people name it: `de-1996` German, `en-gb` British English. */
export function languageName(tag: string): string {
  return names.of(tag.replace(/-\d{4}$/, '')) ?? tag;
}

export function hyphenationNotice(tags: readonly string[]): string {
  const list: readonly string[] = tags.map(languageName);
  const joined: string = list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `Hyphenation for ${joined} applies after reopening`;
}

export function useHyphenationNotice(editor: EditorController | null, idleMs: number, delay: Delay): string | null {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect((): (() => void) | undefined => {
    setNotice(null);
    if (editor === null) return undefined;
    const announced: Set<string> = new Set<string>();
    let live: boolean = true;
    let cancel: (() => void) | null = null;
    const check = (): void => {
      editor.missingPatterns().then((tags: readonly string[]): void => {
        const fresh: readonly string[] = tags.filter((t: string): boolean => !announced.has(t));
        if (!live || fresh.length === 0) return;
        fresh.forEach((t: string): void => { announced.add(t); });
        setNotice(hyphenationNotice(fresh));
      }, (error: unknown): void => {
        if (live) setNotice(`Hyphenation could not be checked: ${error instanceof Error ? error.message : String(error)}`);
      });
    };
    const edited = (): void => {
      cancel?.();
      cancel = delay(idleMs, check);
    };
    const off: (() => void)[] = [editor.on('change', edited), editor.on('pages', edited)];
    return (): void => {
      live = false;
      cancel?.();
      off.forEach((f: () => void): void => f());
    };
  }, [editor, idleMs, delay]);
  return notice;
}
