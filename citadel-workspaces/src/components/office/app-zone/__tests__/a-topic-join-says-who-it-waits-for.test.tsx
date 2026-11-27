/**
 * What every surface an app runs on shows while one of its topics is not joined
 * (TopicJoinNotice.tsx over topic-join-store.ts): the try under way as "attempt N of M"; then who it
 * waits for, with Try again reaching the install's running instances; nothing once joined.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TopicJoinNotice } from '../TopicJoinNotice';
import { offerTopicRetry, showTopicJoin } from '@/lib/citadel-apps/topic-join-store';

describe('a topic join on the page', () => {
  it('shows the attempt, then the owner it waits for with Try again, and nothing once in', () => {
    const asked: string[] = [];
    const stop: () => void = offerTopicRetry('i1', (topic: string): void => { asked.push(topic); });
    render(<TopicJoinNotice installId="i1" appName="Calendar" />);
    expect(screen.queryByTestId('topic-join-notice')).toBeNull();
    act(() => showTopicJoin('i1', 'cal', { kind: 'joining', attempt: 2, of: 3 }));
    expect(screen.getByRole('status').textContent).toBe("Joining Calendar's live updates: attempt 2 of 3");
    expect(screen.queryByTestId('topic-join-retry')).toBeNull();
    act(() => showTopicJoin('i1', 'cal', { kind: 'waiting', owner: 'amy' }));
    expect(screen.getByRole('status').textContent).toContain("Waiting for amy to open Calendar; you'll join when they do");
    fireEvent.click(screen.getByTestId('topic-join-retry'));
    expect(asked).toEqual(['cal']);
    act(() => showTopicJoin('i1', 'cal', { kind: 'in' }));
    expect(screen.queryByTestId('topic-join-notice')).toBeNull();
    act(() => stop());
  });

  it('another install’s join is not shown here', () => {
    render(<TopicJoinNotice installId="i2" appName="Compute Pool" />);
    act(() => showTopicJoin('i3', 'pool', { kind: 'waiting', owner: null }));
    expect(screen.queryByTestId('topic-join-notice')).toBeNull();
  });
});
