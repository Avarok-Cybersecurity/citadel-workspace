/**
 * Shared wiring for the sign-in tests: the fake agent, the fake authenticator
 * from the passkey tests, and a "user" who touches the key whenever asked.
 */
import { FakeAuthenticator, MemoryStore } from '@/lib/passkey/__tests__/fakes';
import { answerKeyChallenge, type KeyAnswerResult } from '../key-answer';
import { addSecurityKey } from '../enrol-key';
import { openChallenges, settleChallenge, subscribeChallenges } from '../challenge-watch';
import type { SignInDeps } from '../index';
import type { SecurityKeyChallengeNotification } from '../types';
import { FakeAgent } from './fake-agent';

export interface World {
  agent: FakeAgent;
  authenticator: FakeAuthenticator;
  deps: SignInDeps & { store: MemoryStore; authenticator: FakeAuthenticator };
  /** Every answer the user gave, in order. */
  answers: KeyAnswerResult[];
  /** Stop touching the key. */
  stop: () => void;
}

export function world(touchWhenAsked: boolean): World {
  const agent: FakeAgent = new FakeAgent();
  const authenticator: FakeAuthenticator = new FakeAuthenticator();
  const deps: World['deps'] = {
    authenticator, rpId: 'work.avarok.net', rpName: 'Citadel Workspace', send: agent.send, store: new MemoryStore(),
  };
  const answers: KeyAnswerResult[] = [];
  const busy: Set<string> = new Set<string>();
  const onChange = (): void => {
    for (const c of openChallenges()) {
      if (busy.has(c.challenge_id)) continue;
      busy.add(c.challenge_id);
      void answerKeyChallenge(deps, c).then((result: KeyAnswerResult): void => {
        answers.push(result);
        if (result.kind !== 'refused') settleChallenge(c.challenge_id);
      });
    }
  };
  const stop: () => void = touchWhenAsked ? subscribeChallenges(onChange) : (): void => undefined;
  return { agent, authenticator, deps, answers, stop };
}

export const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

export async function until(check: () => boolean, label: string): Promise<void> {
  for (let i: number = 0; i < 200; i += 1) {
    if (check()) return;
    await flush();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export const variants = (w: World): string[] => w.agent.sent.map(([v]) => v);

export const lastChallenge = (): SecurityKeyChallengeNotification | undefined => openChallenges()[openChallenges().length - 1];

/**
 * Enrol a key for an account through the real enrolment, touching it when the
 * server asks, without leaving anything subscribed for the test that follows.
 */
export async function enrolKey(w: World, account: { cid: bigint; username: string; password: string }, label: string = 'YubiKey'): Promise<void> {
  const stop: () => void = subscribeChallenges((): void => {
    for (const c of openChallenges()) {
      settleChallenge(c.challenge_id);
      void answerKeyChallenge(w.deps, c);
    }
  });
  try {
    await addSecurityKey(w.deps, {
      account: { tenant: 'bench.work.avarok.net', cid: account.cid, username: account.username }, label, existingCredentialIds: [],
    }, { password: Array.from(new TextEncoder().encode(account.password)), security_key: true });
  } finally {
    stop();
  }
}
