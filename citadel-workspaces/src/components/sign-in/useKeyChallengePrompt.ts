/**
 * The state behind "Touch your security key": the oldest open challenge for
 * this window, its countdown, and the two things the user can do about it.
 *
 * Continue is a click on purpose. Browsers (Safari above all) run a WebAuthn
 * ceremony only inside a user gesture, and the round trip that produced the
 * challenge has long since lost the one that started the sign-in.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  answerKeyChallenge, browserSignInDeps, CANCELLED_REASON, declineKeyChallenge, openChallenges,
  settleChallenge, subscribeChallenges, touchWindowMs, type KeyAnswerResult,
} from '@/lib/sign-in';
import type { SecurityKeyChallengeNotification } from '@/lib/sign-in/types';
import { describeFailure } from '@/lib/failure-message';

export interface KeyChallengePrompt {
  challenge: SecurityKeyChallengeNotification | null;
  secondsLeft: number;
  busy: boolean;
  /** Why the last answer did not count; the challenge stays open for another try. */
  message: string | null;
  answer: () => void;
  cancel: () => void;
}

const TICK_MS: 1000 = 1000;

export function useKeyChallengePrompt(): KeyChallengePrompt {
  const open: readonly SecurityKeyChallengeNotification[] = useSyncExternalStore(subscribeChallenges, openChallenges);
  const challenge: SecurityKeyChallengeNotification | null = open[0] ?? null;
  const challengeId: string | null = challenge?.challenge_id ?? null;
  const expiresInMs: number = challenge ? touchWindowMs(challenge) : 0;
  // Keyed by challenge, so the next one never inherits the last one's expired deadline.
  const [timing, setTiming] = useState<{ id: string; deadline: number } | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!challengeId) return undefined;
    // The window counts from when it saw the challenge: the agent's deadline is relative too.
    const start: number = Date.now();
    setTiming({ id: challengeId, deadline: start + expiresInMs });
    setNow(start);
    setMessage(null);
    const timer: ReturnType<typeof setInterval> = setInterval((): void => setNow(Date.now()), TICK_MS);
    return (): void => clearInterval(timer);
  }, [challengeId, expiresInMs]);

  const current: boolean = challengeId !== null && timing?.id === challengeId;
  const secondsLeft: number = current && timing
    ? Math.max(0, Math.ceil((timing.deadline - now) / TICK_MS))
    : Math.ceil(expiresInMs / TICK_MS);

  useEffect(() => {
    // Expired: the agent has closed it, and an answer now would only be refused.
    if (challengeId && current && secondsLeft === 0) settleChallenge(challengeId);
  }, [challengeId, current, secondsLeft]);

  const answer: () => void = useCallback((): void => {
    if (!challenge || busy) return;
    setBusy(true);
    setMessage(null);
    answerKeyChallenge(browserSignInDeps(), challenge)
      .then((result: KeyAnswerResult): void => {
        if (result.kind === 'refused') setMessage(result.message);
        else settleChallenge(challenge.challenge_id);
      })
      .catch((error: unknown): void => { setMessage(describeFailure(error, "That didn't work. Try again.")); })
      .finally((): void => setBusy(false));
  }, [challenge, busy]);

  const cancel: () => void = useCallback((): void => {
    if (!challenge) return;
    settleChallenge(challenge.challenge_id);
    declineKeyChallenge(browserSignInDeps(), challenge, CANCELLED_REASON)
      .catch((error: unknown): void => { setMessage(describeFailure(error, 'The request could not be cancelled.')); });
  }, [challenge]);

  return { challenge, secondsLeft, busy, message, answer, cancel };
}
