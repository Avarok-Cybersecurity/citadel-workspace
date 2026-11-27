/**
 * When a member cannot join an app's topic, why, and when to try again. A joiner is admitted only by
 * the topic owner's host while the owner's app is open (topic-port.ts); a topic whose group is gone
 * is hosted by whoever opens it next, so a member never waits on themselves. The host tries a
 * bounded number of times, then waits, and the wait is data (`TopicJoin.waiting`): why, on whom,
 * and how it ends.
 *
 * - `refused`: the owner's host declined. Nothing here can change that, so it ends only by Try
 *   again or a consent change (someone's answer moved).
 * - `owner-offline`: the owner is shown offline. A try is made each `wait.everyMs` once they are
 *   shown online again, until the deadline.
 * - `timeout`: nothing answered in time (the owner's app is closed, or an agent was slow). A try is
 *   made each `wait.everyMs`, until the deadline.
 *
 * Past the deadline only Try again or a consent change tries again; a try made by either starts a
 * new wait with a new deadline. Every app's topics go through this, so the Calendar and the
 * Compute Pool show the same states. A join made here after the app's own open failed is told to
 * the app as a `members` event on that topic. Pure over the injected port, clock, timer and signals.
 */
import type { PortAnswer, TopicArrival } from '../host/ports';
import type { TopicOpened } from '../sdk/generated/TopicOpened';
import type { OwnedTopicPort } from './topic-port';

/** Timer-driven tries in one round, the app's own open being the first. */
export const JOIN_ATTEMPTS: number = 3;

/** How a wait that can end by itself is paced: a try each `everyMs`, for `forMs` after it starts. */
export const TOPIC_WAIT: Readonly<{ everyMs: number; forMs: number }> = { everyMs: 30_000, forMs: 5 * 60_000 };

export type WaitReason = 'owner-offline' | 'refused' | 'timeout';

/** The member a join waits on: never this session (topic-owner.ts). */
export interface TopicOwner {
  readonly username: string;
  readonly cid: bigint;
}

/** How a wait ends: by itself until `deadlineMs` (epoch ms), or only by Try again. */
export type WaitWake = { readonly kind: 'auto'; readonly deadlineMs: number } | { readonly kind: 'manual' };

export type TopicJoin =
  | { readonly kind: 'joining'; readonly attempt: number; readonly of: number }
  | { readonly kind: 'waiting'; readonly reason: WaitReason; readonly owner: TopicOwner | null; readonly wake: WaitWake }
  | { readonly kind: 'in' };

export interface RejoinDeps {
  /** Between one try and the next in a round (the host's port bound, so tries never overlap). */
  readonly intervalMs: number;
  readonly wait: Readonly<{ everyMs: number; forMs: number }>;
  readonly nowMs: () => number;
  readonly after: (ms: number, fire: () => void) => () => void;
  /** The member whose app admits joiners to `topic`; null when the host cannot say, or it would be this session. */
  readonly owner: (topic: string) => Promise<TopicOwner | null>;
  /** Whether a member is shown online (lib/presence.ts): null when it is not known or not shown. */
  readonly presence: (cid: bigint) => boolean | null;
  /** Fires when a member's consent changed: an admission refused before may be given now. */
  readonly consentChanges: (listener: () => void) => () => void;
  readonly shown: (topic: string, join: TopicJoin) => void;
}

export type RejoiningTopicPort = OwnedTopicPort & { readonly tryAgain: (topic: string) => void };

interface Track {
  attempt: number;
  of: number;
  waiting: boolean;
  trying: boolean;
  /** When the current wait stops trying by itself; null outside a wait. */
  deadlineMs: number | null;
  cancel: () => void;
}

const isUnavailable = (a: PortAnswer<TopicOpened>): boolean => 'refused' in a && typeof a.refused === 'object' && 'unavailable' in a.refused;

export function rejoining(port: OwnedTopicPort, d: RejoinDeps): RejoiningTopicPort {
  const tracks: Map<string, Track> = new Map<string, Track>();
  const listeners: Set<(a: TopicArrival) => void> = new Set<(a: TopicArrival) => void>();
  const show = (topic: string, t: Track): void => d.shown(topic, { kind: 'joining', attempt: t.attempt, of: t.of });
  const live = (topic: string, t: Track): boolean => tracks.get(topic) === t;

  /** Shows the wait and, while it may end by itself, arms its next try. */
  const wait = (topic: string, t: Track, owner: TopicOwner | null): void => {
    const reason: WaitReason = port.outReason(topic) === 'refused' ? 'refused' : owner !== null && d.presence(owner.cid) === false ? 'owner-offline' : 'timeout';
    t.deadlineMs ??= d.nowMs() + d.wait.forMs;
    const auto: boolean = reason !== 'refused' && d.nowMs() < t.deadlineMs;
    d.shown(topic, { kind: 'waiting', reason, owner, wake: auto ? { kind: 'auto', deadlineMs: t.deadlineMs } : { kind: 'manual' } });
    if (!auto) return;
    t.cancel = d.after(d.wait.everyMs, (): void => {
      if (!live(topic, t) || t.trying) return;
      // An owner shown offline is not asked again until they are shown online.
      if (reason === 'owner-offline' && owner !== null && d.presence(owner.cid) !== true) { wait(topic, t, owner); return; }
      void attempt(topic, t, false);
    });
  };
  const failed = (topic: string, t: Track): void => {
    if (!t.waiting && t.attempt < t.of) {
      t.cancel = d.after(d.intervalMs, (): void => { t.attempt += 1; void attempt(topic, t, true); });
      return;
    }
    t.waiting = true;
    void d.owner(topic).then((owner: TopicOwner | null): void => { if (live(topic, t)) wait(topic, t, owner); });
  };
  /** One try made by the host: the app's own open already answered, so a success is told as an event. A try inside a wait keeps the wait shown. */
  const attempt = async (topic: string, t: Track, shown: boolean): Promise<void> => {
    t.trying = true;
    if (shown) show(topic, t);
    const answer: PortAnswer<TopicOpened> = await port.TopicOpen({ name: topic });
    t.trying = false;
    if (!live(topic, t)) return;
    if ('ok' in answer) {
      tracks.delete(topic);
      d.shown(topic, { kind: 'in' });
      for (const l of [...listeners]) l({ name: topic, event: { members: [...answer.ok.members] } });
      return;
    }
    failed(topic, t);
  };
  /** Try once now (Try again, or a signal): the round is that one try, and a failure starts a new wait. */
  const once = (topic: string): void => {
    const t: Track | undefined = tracks.get(topic);
    if (t === undefined || t.trying) return;
    t.cancel();
    if (t.waiting) Object.assign(t, { attempt: 1, of: 1, waiting: false, deadlineMs: null });
    else t.attempt += 1;
    void attempt(topic, t, true);
  };
  const stopConsent: () => void = d.consentChanges((): void => { for (const topic of [...tracks.keys()]) once(topic); });
  const untrack = (topic: string): void => { tracks.get(topic)?.cancel(); tracks.delete(topic); };

  return {
    ...port,
    TopicOpen: async (args: { name: string }): Promise<PortAnswer<TopicOpened>> => {
      untrack(args.name);
      const t: Track = { attempt: 1, of: JOIN_ATTEMPTS, waiting: false, trying: true, deadlineMs: null, cancel: (): void => undefined };
      tracks.set(args.name, t);
      show(args.name, t);
      const answer: PortAnswer<TopicOpened> = await port.TopicOpen(args);
      t.trying = false;
      if (!live(args.name, t)) return answer;
      if (isUnavailable(answer)) failed(args.name, t);
      else { tracks.delete(args.name); if ('ok' in answer) d.shown(args.name, { kind: 'in' }); }
      return answer;
    },
    TopicClose: (args: { name: string }): PortAnswer<null> | Promise<PortAnswer<null>> => { untrack(args.name); return port.TopicClose(args); },
    closeAll: (): Promise<void> => {
      for (const topic of [...tracks.keys()]) untrack(topic);
      stopConsent();
      listeners.clear();
      return port.closeAll();
    },
    onEvent: (listener: (a: TopicArrival) => void): (() => void) => {
      listeners.add(listener);
      const stop: () => void = port.onEvent(listener);
      return (): void => { listeners.delete(listener); stop(); };
    },
    tryAgain: once,
  };
}
