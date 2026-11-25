/**
 * Where this page's app instances say how their topic joins stand (runtime/topic-rejoin.ts), by
 * install, for the zone, page and tab surfaces to show, and where Try again reaches the instances
 * of that install. Data only: the instances write it, the surfaces read it.
 */
import type { TopicJoin } from './runtime/topic-rejoin';

type Joins = ReadonlyMap<string, TopicJoin>;

const EMPTY: Joins = new Map<string, TopicJoin>();
const joins: Map<string, Joins> = new Map<string, Joins>();
const retries: Map<string, Set<(topic: string) => void>> = new Map<string, Set<(topic: string) => void>>();
const listeners: Set<() => void> = new Set<() => void>();

export function showTopicJoin(installId: string, topic: string, join: TopicJoin): void {
  const next: Map<string, TopicJoin> = new Map<string, TopicJoin>(joins.get(installId) ?? EMPTY);
  if (join.kind === 'in') next.delete(topic);
  else next.set(topic, join);
  joins.set(installId, next);
  for (const l of [...listeners]) l();
}

/** The install's topics that are not joined yet, by name; a new map whenever one changes. */
export function topicJoinsOf(installId: string): Joins {
  return joins.get(installId) ?? EMPTY;
}

export function onTopicJoins(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

/** An instance's Try again; returns its removal, for when the instance stops. */
export function offerTopicRetry(installId: string, retry: (topic: string) => void): () => void {
  const set: Set<(topic: string) => void> = retries.get(installId) ?? new Set<(topic: string) => void>();
  set.add(retry);
  retries.set(installId, set);
  return (): void => {
    set.delete(retry);
    if (set.size > 0) return;
    retries.delete(installId);
    joins.delete(installId);
    for (const l of [...listeners]) l();
  };
}

export function tryTopicAgain(installId: string, topic: string): void {
  for (const retry of [...(retries.get(installId) ?? [])]) retry(topic);
}
