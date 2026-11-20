import { useState } from 'react';
import { cellError, enter, PHRASE_WORDS, wordsOf } from '@/lib/recovery/phrase-entry';

/**
 * The 24 boxes of a recovery phrase. Paste the whole phrase into any box and it fills all 24; a
 * line of words fills from that box on. A box holding a word that is not on the recovery word list
 * is marked as it is left, and says which word.
 */
export function PhraseEntry({ cells, onChange, describedBy, disabled }: {
  cells: readonly string[];
  onChange: (cells: string[]) => void;
  /** The form's own hint and error, which describe every box. */
  describedBy: string;
  disabled: boolean;
}): JSX.Element {
  /** Boxes the person has left: only those are marked, so a word half-typed is not called wrong. */
  const [left, setLeft] = useState<ReadonlySet<number>>(new Set<number>());
  const focus = (i: number): void => { if (i < PHRASE_WORDS) document.getElementById(`recovery-word-${i}`)?.focus(); };
  const take = (at: number, text: string): void => {
    const words: string[] = wordsOf(text);
    const next: string[] = enter(cells, at, text);
    onChange(next);
    if (words.length > 1) {
      setLeft(new Set<number>(next.map((_c: string, i: number) => i).filter((i: number) => next[i] !== '')));
      const empty: number = next.findIndex((cell: string) => cell === '');
      focus(empty === -1 ? PHRASE_WORDS - 1 : empty);
    } else if (words.length === 1 && /\s$/.test(text)) {
      focus(at + 1);
    }
  };

  return (
    <ol className="grid grid-cols-2 sm:grid-cols-3 gap-2" aria-label={`Recovery phrase, ${PHRASE_WORDS} words`} data-testid="recover-phrase-cells">
      {cells.map((cell: string, i: number) => {
        const problem: string | null = left.has(i) ? cellError(cell, i) : null;
        return (
          <li key={i} className="flex min-w-0 items-center gap-1.5">
            <label htmlFor={`recovery-word-${i}`} className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              <span className="sr-only">Word </span>{i + 1}
            </label>
            <input
              id={`recovery-word-${i}`} value={cell} disabled={disabled}
              autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text"
              aria-invalid={problem !== null ? true : undefined}
              aria-describedby={problem !== null ? `recovery-word-${i}-error ${describedBy}` : describedBy}
              className="min-h-[44px] w-full min-w-0 rounded-md border border-border bg-input px-2 font-mono text-sm text-foreground focus:border-primary-accent focus:outline-none focus:ring-1 focus:ring-ring/30 aria-[invalid=true]:border-destructive"
              data-testid="recover-phrase-word"
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void => take(i, e.target.value)}
              onBlur={(): void => setLeft((was: ReadonlySet<number>) => new Set<number>([...was, i]))}
              onPaste={(e: React.ClipboardEvent<HTMLInputElement>): void => {
                const pasted: string = e.clipboardData.getData('text');
                if (!/\s/.test(pasted.trim())) return;
                e.preventDefault();
                take(i, pasted);
              }}
            />
            {problem !== null && <span id={`recovery-word-${i}-error`} className="sr-only">{problem}</span>}
          </li>
        );
      })}
    </ol>
  );
}
