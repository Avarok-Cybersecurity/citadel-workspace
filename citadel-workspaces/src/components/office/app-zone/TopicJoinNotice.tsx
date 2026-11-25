/**
 * How an install's topic joins stand on this page (runtime/topic-rejoin.ts), above the app on every
 * surface it runs on (zone, page, tab): the try under way, then who the member is waiting for, with
 * Try again. Nothing is shown once every topic is joined.
 */
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { onTopicJoins, topicJoinsOf, tryTopicAgain } from '@/lib/citadel-apps/topic-join-store';
import type { TopicJoin } from '@/lib/citadel-apps/runtime/topic-rejoin';

interface TopicJoinNoticeProps {
  readonly installId: string;
  readonly appName: string;
}

export function joinWords(join: Exclude<TopicJoin, { kind: 'in' }>, appName: string): string {
  if (join.kind === 'joining') return `Joining ${appName}'s live updates: attempt ${join.attempt} of ${join.of}`;
  return `Waiting for ${join.owner ?? 'the member who started it'} to open ${appName}; you'll join when they do`;
}

export function TopicJoinNotice({ installId, appName }: TopicJoinNoticeProps): JSX.Element | null {
  const joins: ReadonlyMap<string, TopicJoin> = useSyncExternalStore(onTopicJoins, (): ReadonlyMap<string, TopicJoin> => topicJoinsOf(installId));
  const shown: [string, Exclude<TopicJoin, { kind: 'in' }>][] = [...joins.entries()].filter(
    (e: [string, TopicJoin]): e is [string, Exclude<TopicJoin, { kind: 'in' }>] => e[1].kind !== 'in',
  );
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="topic-join-notice">
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
