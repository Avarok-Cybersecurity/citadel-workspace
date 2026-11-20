import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PHRASE_CHECKS, phraseChecks, phraseMatches } from '@/lib/sign-in-with-citadel/phrase-check';
import { PHRASE_COPY } from '@/lib/recovery/copy';

/** A uniform index in `[0, bound)` from the browser's CSPRNG. */
function randomIndex(bound: number): number {
  const word: Uint32Array = new Uint32Array(1);
  const limit: number = Math.floor(0x1_0000_0000 / bound) * bound;
  do crypto.getRandomValues(word); while (word[0] >= limit);
  return word[0] % bound;
}

/**
 * "Confirm 3 words": the person types back the words at three positions chosen at random. Continue
 * stays disabled until each box holds something; a mismatch says so without revealing which word.
 */
export function PhraseConfirm({ words, onConfirmed, onShowAgain }: {
  words: readonly string[];
  onConfirmed: () => void;
  onShowAgain: () => void;
}): JSX.Element {
  const [checks] = useState<number[]>(() => phraseChecks(words.length, randomIndex));
  const [answers, setAnswers] = useState<string[]>(() => Array.from({ length: PHRASE_CHECKS }, (): string => ''));
  const [error, setError] = useState<string | null>(null);
  const first: React.RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  useEffect((): void => { first.current?.focus(); }, []);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (phraseMatches(words, checks, answers)) { onConfirmed(); return; }
    setError(PHRASE_COPY.confirmMismatch);
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate data-testid="recovery-phrase-check" aria-labelledby="recovery-phrase-check-title">
      <h2 id="recovery-phrase-check-title" className="text-lg font-bold text-foreground">{PHRASE_COPY.confirmTitle}</h2>
      <p className="text-sm text-muted-foreground">{PHRASE_COPY.confirmBody}</p>
      {checks.map((position: number, i: number) => (
        <div key={position} className="space-y-1.5">
          <Label htmlFor={`recovery-phrase-check-${position}`}>Word {position + 1}</Label>
          <Input id={`recovery-phrase-check-${position}`} ref={i === 0 ? first : undefined} value={answers[i]}
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            aria-invalid={error !== null ? true : undefined} aria-describedby={error !== null ? 'recovery-phrase-check-error' : undefined}
            className="min-h-[44px]" data-testid="recovery-phrase-check-word" data-position={position}
            onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
              const next: string[] = [...answers];
              next[i] = e.target.value;
              setAnswers(next);
              setError(null);
            }} />
        </div>
      ))}
      {error !== null && <p id="recovery-phrase-check-error" role="alert" className="text-sm text-destructive-emphasis">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" className="min-h-[44px]" onClick={onShowAgain} data-testid="recovery-phrase-show-again">
          {PHRASE_COPY.showAgain}
        </Button>
        <Button type="submit" className="min-h-[44px]" disabled={answers.some((a: string) => a.trim() === '')} data-testid="recovery-phrase-confirm">
          Continue
        </Button>
      </div>
    </form>
  );
}
