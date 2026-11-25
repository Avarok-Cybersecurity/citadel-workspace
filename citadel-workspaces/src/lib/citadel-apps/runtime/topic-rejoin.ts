/**
 * When a member cannot join an app's topic, why, and when to try again. A joiner is admitted only by
 * the topic owner's host while the owner's app is open (topic-port.ts), so "nobody admitted me" is
 * usually a lasting state, not a blip: the host tries a bounded number of times, then says who it
 * is waiting for and offers Try again, and it tries once more by itself only when something on the
 * wire says the answer may have changed (a consent change). There is no signal that the owner opened
 * the app, and member presence is a poll that does not say so either, so none is invented here.
 *
 * Every app's topics go through this, so the Calendar and the Compute Pool show the same states. A
 * join made here after the app's own open failed is told to the app as a `members` event on that
 * topic: the Calendar is already listening, and the Compute Pool opens the topic again on it, which
 * answers at once because the session is already in. Pure over the injected port, timer and signals.
 */
import type { PortAnswer, TopicArrival } from '../host/ports';
import type { TopicOpened } from '../sdk/generated/TopicOpened';
import type { OwnedTopicPort } from './topic-port';

/** Timer-driven tries in one round, the app's own open being the first. */
export const JOIN_ATTEMPTS: number = 3;

export type TopicJoin =
  | { readonly kind: 'joining'; readonly attempt: number; readonly of: number }
  | { readonly kind: 'waiting'; readonly owner: string | null }
  | { readonly kind: 'in' };

export interface RejoinDeps {
  /** Between one try and the next in a round (the host's port bound, so tries never overlap). */
  readonly intervalMs: number;
  readonly after: (ms: number, fire: () => void) => () => void;
  /** The username of the member whose app admits joiners to `topic`; null when the host cannot say. */
  readonly owner: (topic: string) => Promise<string | null>;
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
  cancel: () => void;
}

const isUnavailable = (a: PortAnswer<TopicOpened>): boolean => 'refused' in a && typeof a.refused === 'object' && 'unavailable' in a.refused;

export function rejoining(port: OwnedTopicPort, d: RejoinDeps): RejoiningTopicPort {
  const tracks: Map<string, Track> = new Map<string, Track>();
  const listeners: Set<(a: TopicArrival) => void> = new Set<(a: TopicArrival) => void>();
  const show = (topic: string, t: Track): void => d.shown(topic, { kind: 'joining', attempt: t.attempt, of: t.of });

  const failed = (topic: string, t: Track): void => {
    if (t.attempt >= t.of) {
      t.waiting = true;
      void d.owner(topic).then((owner: string | null): void => { if (tracks.get(topic) === t) d.shown(topic, { kind: 'waiting', owner }); });
      return;
    }
    t.cancel = d.after(d.intervalMs, (): void => { t.attempt += 1; void attempt(topic, t); });
  };
  /** One try made by the host: the app's own open already answered, so a success is told as an event. */
  const attempt = async (topic: string, t: Track): Promise<void> => {
    t.trying = true;
    show(topic, t);
    const answer: PortAnswer<TopicOpened> = await port.TopicOpen({ name: topic });
    t.trying = false;
    if (tracks.get(topic) !== t) return;
    if ('ok' in answer) {
      tracks.delete(topic);
      d.shown(topic, { kind: 'in' });
      for (const l of [...listeners]) l({ name: topic, event: { members: [...answer.ok.members] } });
      return;
    }
    failed(topic, t);
  };
  /** Try once now (Try again, or a signal): the round is that one try. */
  const once = (topic: string): void => {
    const t: Track | undefined = tracks.get(topic);
    if (t === undefined || t.trying) return;
    t.cancel();
    if (t.waiting) Object.assign(t, { attempt: 1, of: 1, waiting: false });
    else t.attempt += 1;
    void attempt(topic, t);
  };
  const stopConsent: () => void = d.consentChanges((): void => { for (const topic of [...tracks.keys()]) once(topic); });
  const untrack = (topic: string): void => { tracks.get(topic)?.cancel(); tracks.delete(topic); };

  return {
    ...port,
    TopicOpen: async (args: { name: string }): Promise<PortAnswer<TopicOpened>> => {
      untrack(args.name);
      const t: Track = { attempt: 1, of: JOIN_ATTEMPTS, waiting: false, trying: true, cancel: (): void => undefined };
      tracks.set(args.name, t);
      show(args.name, t);
      const answer: PortAnswer<TopicOpened> = await port.TopicOpen(args);
      t.trying = false;
      if (tracks.get(args.name) !== t) return answer;
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
