/**
 * The security-key challenges THIS window was asked to answer.
 *
 * A challenge names the request that caused it (a Connect or a
 * SignInManagement), never a session: during a sign-in there is no session, so
 * its `cid` is 0. The leader routes it to the asking tab by that request id
 * (route-by-request-id.ts); this is the second half of the rule -- a window
 * shows a challenge only for a request it is itself waiting on, so a challenge
 * that reached the wrong tab by any other path asks nobody to touch anything.
 *
 * State lives here, not in React, because the request that is waiting and the
 * prompt that answers are different components.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { notifyEach } from '@/lib/notify-listeners';
import type { SecurityKeyChallengeNotification } from './types';

type Listener = () => void;

const watched: Set<string> = new Set<string>();
let open: readonly SecurityKeyChallengeNotification[] = [];
const listeners: Set<Listener> = new Set<Listener>();
let installed: boolean = false;

/** Isolated: a prompt that throws must not stop another hearing of the challenge. */
function notify(): void {
  notifyEach(listeners, 'key-challenge');
}

function unwrap(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== 'object') return null;
  const record: Record<string, unknown> = message as Record<string, unknown>;
  const inner: unknown = record.Response;
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : record;
}

/** The challenge in a message off the bus, if it is one. */
export function challengeIn(message: unknown): SecurityKeyChallengeNotification | null {
  const record: Record<string, unknown> | null = unwrap(message);
  const value: unknown = record?.SecurityKeyChallengeNotification;
  return value && typeof value === 'object' ? (value as SecurityKeyChallengeNotification) : null;
}

function onMessage(message: unknown): void {
  const challenge: SecurityKeyChallengeNotification | null = challengeIn(message);
  if (!challenge || challenge.request_id === null || !watched.has(challenge.request_id)) return;
  if (open.some((c) => c.challenge_id === challenge.challenge_id)) return;
  open = [...open, challenge];
  notify();
}

/**
 * Show the challenges `requestId` causes until the returned function is called,
 * which also withdraws any still on screen: the request they belong to is over.
 */
export function watchKeyChallenges(requestId: string): () => void {
  if (!installed) {
    eventEmitter.on('websocket-message', onMessage);
    installed = true;
  }
  watched.add(requestId);
  return (): void => {
    watched.delete(requestId);
    const before: number = open.length;
    open = open.filter((c) => c.request_id !== requestId);
    if (open.length !== before) notify();
  };
}

/** The challenges waiting for a touch, oldest first. A stable array between changes. */
export function openChallenges(): readonly SecurityKeyChallengeNotification[] {
  return open;
}

/** A challenge answered, declined or expired: it leaves the screen. */
export function settleChallenge(challengeId: string): void {
  const before: number = open.length;
  open = open.filter((c) => c.challenge_id !== challengeId);
  if (open.length !== before) notify();
}

export function subscribeChallenges(listener: Listener): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

/**
 * The challenge's touch window, in milliseconds, as a number. The agent's field
 * is a u64, and the WASM client hands every u64 to JavaScript as a BigInt
 * (serialize_large_number_types_as_bigints), whatever the generated type says:
 * arithmetic on it as it arrives throws, and threw in the prompt's render.
 */
export function touchWindowMs(challenge: SecurityKeyChallengeNotification): number {
  return Number(challenge.expires_in_ms);
}

/**
 * How much longer a request may wait because a challenge for it arrived: the
 * touch window plus the request's own budget, so the user's touch is never cut
 * short by a timeout written for a password round trip. Null for anything else.
 */
export function extensionFor(message: unknown, requestId: string, budgetMs: number): number | null {
  const challenge: SecurityKeyChallengeNotification | null = challengeIn(message);
  if (!challenge || challenge.request_id !== requestId) return null;
  return touchWindowMs(challenge) + budgetMs;
}
