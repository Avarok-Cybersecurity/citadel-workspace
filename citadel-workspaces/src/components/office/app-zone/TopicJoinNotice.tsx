/**
 * How an install's topic joins stand on this page (runtime/topic-rejoin.ts), above the app on every
 * surface it runs on (zone, page, tab): the try under way, then who the member is waiting for, with
 * Try again. Nothing is shown once every topic is joined. A member is never told to wait for
 * themselves: a topic whose group is gone is hosted by whoever opens it next (topic-port.ts), so
 * waiting means another member hosts it and has not let this one in.
 */
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { onTopicJoins, topicJoinsOf, tryTopicAgain } from '@/lib/citadel-apps/topic-join-store';
import type { TopicJoin } from '@/lib/citadel-apps/runtime/topic-rejoin';

interface TopicJoinNoticeProps {
  readonly installId: string;
  readonly appName: string;
}

/** The clock time a wait stops trying by itself, as the member reads clocks. */
export function untilWords(deadlineMs: number): string {
  return new Date(deadlineMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Says why, on whom, and what happens next: a wait that ends by itself says until when; one that does not says what to do. */
export function joinWords(join: Exclude<TopicJoin, { kind: 'in' }>, appName: string): string {
  if (join.kind === 'joining') return `Joining ${appName}'s live updates: attempt ${join.attempt} of ${join.of}`;
  const owner: string | null = join.owner?.username ?? null;
  const by: string | null = join.wake.kind === 'auto' ? untilWords(join.wake.deadlineMs) : null;
  if (join.reason === 'refused') {
    return `${owner ?? `The member hosting ${appName}'s live updates`}${owner === null ? '' : ` hosts ${appName}'s live updates and`} did not let you in. Ask them to allow you, then try again`;
  }
  if (join.reason === 'owner-offline' && owner !== null) {
    return by === null
      ? `${owner} hosts ${appName}'s live updates and is still offline. Try again once they are back`
      : `${owner} hosts ${appName}'s live updates and is offline. You will join by yourself if they are back before ${by}`;
  }
  const head: string = owner === null ? `Nobody hosting ${appName}'s live updates has let you in yet` : `${owner} has not let you in to ${appName}'s live updates yet; they need ${appName} open`;
  if (by !== null) return `${head}. Trying again by itself until ${by}`;
  return owner === null ? `${head}. Try again; if it keeps failing, reload the page` : `${head}. Try again once they have it open`;
}

export function TopicJoinNotice({ installId, appName }: TopicJoinNoticeProps): JSX.Element | null {
  const joins: ReadonlyMap<string, TopicJoin> = useSyncExternalStore(onTopicJoins, (): ReadonlyMap<string, TopicJoin> => topicJoinsOf(installId));
  const shown: [string, Exclude<TopicJoin, { kind: 'in' }>][] = [...joins.entries()].filter(
    (e: [string, TopicJoin]): e is [string, Exclude<TopicJoin, { kind: 'in' }>] => e[1].kind !== 'in',
  );
  if (shown.length === 0) return null;
  return (
    // Its own gap above and below: it sits under a tab row's border and over the app, and touched both.
    <div className="flex flex-col gap-2 py-[8px]" data-testid="topic-join-notice">
      {shown.map(([topic, join]: [string, Exclude<TopicJoin, { kind: 'in' }>]) => (
        <div key={topic} role="status" className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm text-muted-foreground">
          <span>{joinWords(join, appName)}</span>
          {join.kind === 'waiting' && (
            <Button variant="outline" className="min-h-[44px] min-w-[44px]" onClick={(): void => tryTopicAgain(installId, topic)} data-testid="topic-join-retry">Try again</Button>
          )}
        </div>
      ))}
    </div>
  );
}
