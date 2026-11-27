/**
 * What every surface an app runs on shows while one of its topics is not joined
 * (TopicJoinNotice.tsx over topic-join-store.ts): the try under way as "attempt N of M"; then why it
 * waits, on whom, and what happens next: until when it keeps trying by itself, or what the member
 * does when it no longer does; Try again reaches the install's running instances; nothing once joined.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TopicJoinNotice, untilWords } from '../TopicJoinNotice';
import { offerTopicRetry, showTopicJoin } from '@/lib/citadel-apps/topic-join-store';
import type { TopicJoin, TopicOwner } from '@/lib/citadel-apps/runtime/topic-rejoin';

const AMY: TopicOwner = { username: 'amy', cid: 5n };
const DEADLINE: number = Date.UTC(2026, 10, 27, 15, 5);

function said(install: string, join: TopicJoin): string {
  act(() => showTopicJoin(install, 'cal', join));
  return screen.getByRole('status').textContent ?? '';
}

describe('a topic join on the page', () => {
  it('shows the attempt, then why it waits with Try again, and nothing once in', () => {
    const asked: string[] = [];
    const stop: () => void = offerTopicRetry('i1', (topic: string): void => { asked.push(topic); });
    render(<TopicJoinNotice installId="i1" appName="Calendar" />);
    expect(screen.queryByTestId('topic-join-notice')).toBeNull();
    expect(said('i1', { kind: 'joining', attempt: 2, of: 3 })).toBe("Joining Calendar's live updates: attempt 2 of 3");
    expect(screen.queryByTestId('topic-join-retry')).toBeNull();
    expect(said('i1', { kind: 'waiting', reason: 'timeout', owner: AMY, wake: { kind: 'auto', deadlineMs: DEADLINE } }))
      .toContain(`amy has not let you in to Calendar's live updates yet; they need Calendar open. Trying again by itself until ${untilWords(DEADLINE)}`);
    fireEvent.click(screen.getByTestId('topic-join-retry'));
    expect(asked).toEqual(['cal']);
    act(() => showTopicJoin('i1', 'cal', { kind: 'in' }));
    expect(screen.queryByTestId('topic-join-notice')).toBeNull();
    act(() => stop());
  });

  it('says each reason, and what to do once nothing tries by itself', () => {
    const stop: () => void = offerTopicRetry('i5', (): void => undefined);
    render(<TopicJoinNotice installId="i5" appName="Calendar" />);
    expect(said('i5', { kind: 'waiting', reason: 'owner-offline', owner: AMY, wake: { kind: 'auto', deadlineMs: DEADLINE } }))
      .toContain(`amy hosts Calendar's live updates and is offline. You will join by yourself if they are back before ${untilWords(DEADLINE)}`);
    expect(said('i5', { kind: 'waiting', reason: 'owner-offline', owner: AMY, wake: { kind: 'manual' } }))
      .toContain("amy hosts Calendar's live updates and is still offline. Try again once they are back");
    expect(said('i5', { kind: 'waiting', reason: 'refused', owner: AMY, wake: { kind: 'manual' } }))
      .toContain("amy hosts Calendar's live updates and did not let you in. Ask them to allow you, then try again");
    expect(said('i5', { kind: 'waiting', reason: 'timeout', owner: AMY, wake: { kind: 'manual' } }))
      .toContain("amy has not let you in to Calendar's live updates yet; they need Calendar open. Try again once they have it open");
    act(() => stop());
  });

  it('never names a member who is not known, nor promises a join nothing will make', () => {
    const stop: () => void = offerTopicRetry('i4', (): void => undefined);
    render(<TopicJoinNotice installId="i4" appName="Calendar" />);
    const words: string = said('i4', { kind: 'waiting', reason: 'timeout', owner: null, wake: { kind: 'manual' } });
    expect(words).toContain("Nobody hosting Calendar's live updates has let you in yet. Try again; if it keeps failing, reload the page");
    expect(words).not.toMatch(/member who started it|when they do/);
    expect(said('i4', { kind: 'waiting', reason: 'refused', owner: null, wake: { kind: 'manual' } }))
      .toContain("The member hosting Calendar's live updates did not let you in. Ask them to allow you, then try again");
    expect(screen.getByTestId('topic-join-retry')).toBeTruthy();
    act(() => stop());
  });

  it('another install’s join is not shown here', () => {
    render(<TopicJoinNotice installId="i2" appName="Compute Pool" />);
    act(() => showTopicJoin('i3', 'pool', { kind: 'waiting', reason: 'timeout', owner: null, wake: { kind: 'manual' } }));
    expect(screen.queryByTestId('topic-join-notice')).toBeNull();
  });
});
