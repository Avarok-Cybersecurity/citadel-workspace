import { useRef } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { challengeTitle, secondsLeftCopy, SIGN_IN_COPY } from '@/lib/sign-in/copy';
import { useKeyChallengePrompt, type KeyChallengePrompt } from './useKeyChallengePrompt';

/** What a screen reader hears: the start, then the last stretch, not every second. */
export function announcedSeconds(seconds: number): number | null {
  if (seconds <= 10) return seconds;
  return seconds % 15 === 0 ? seconds : null;
}

/**
 * "Touch your security key", for any request this window made that needs one:
 * a sign-in, a step-up or the key being added. Mounted once, in App.
 *
 * Only this window's challenges reach it (lib/sign-in/challenge-watch.ts). It
 * is a dialog, so focus moves into it and stays there; Cancel declines the
 * challenge, which fails the request at once rather than at the deadline.
 */
export function SecurityKeyPrompt(): JSX.Element | null {
  const p: KeyChallengePrompt = useKeyChallengePrompt();
  const continueRef: React.RefObject<HTMLButtonElement> = useRef<HTMLButtonElement>(null);
  if (!p.challenge) return null;
  const announced: number | null = announcedSeconds(p.secondsLeft);
  return (
    <AlertDialog open onOpenChange={(open: boolean) => { if (!open) p.cancel(); }}>
      {/* Focus lands on Continue, the one thing to do, rather than Radix's default of Cancel. */}
      <AlertDialogContent data-testid="security-key-prompt" onOpenAutoFocus={(e: Event) => { e.preventDefault(); continueRef.current?.focus(); }}>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary-accent" aria-hidden="true" />
            <AlertDialogTitle>{challengeTitle(p.challenge.purpose)}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>{SIGN_IN_COPY.touchHint}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm tabular-nums text-muted-foreground" aria-hidden="true" data-testid="security-key-countdown">
          {secondsLeftCopy(p.secondsLeft)}
        </p>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announced === null ? '' : secondsLeftCopy(announced)}
        </p>
        {p.message && <p role="alert" className="text-sm text-destructive-emphasis">{p.message}</p>}
        <AlertDialogFooter>
          <Button type="button" variant="ghost" onClick={p.cancel} data-testid="security-key-cancel">Cancel</Button>
          <Button type="button" ref={continueRef} disabled={p.busy} onClick={p.answer} data-testid="security-key-continue">
            {p.busy ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{SIGN_IN_COPY.waitingForKey}</>) : SIGN_IN_COPY.continueWithKey}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
