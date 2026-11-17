/**
 * IncomingCallCard's own comment says it "announces itself through a live
 * region instead" of taking focus, because taking focus mid-typing is hostile.
 * There was no live region anywhere in the call path — role="group" is inserted
 * silently — so a screen-reader user with call sounds off was told nothing at
 * all, for the full 45-second ring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { IncomingCallCard } from '../IncomingCallCard';

const media: { audio: boolean; video: boolean; screen: boolean; } = { audio: true, video: true, screen: false };

describe('IncomingCallCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('announces the incoming call through a live region', () => {
    render(
      <IncomingCallCard callerName="Ada" media={media} onAccept={vi.fn()} onDecline={vi.fn()} />,
    );

    const region: HTMLElement = screen.getByRole('alert');
    // Deliberately empty on mount: a live region that arrives WITH its content
    // is frequently not announced, because AT watches it for changes.
    expect(region).toHaveTextContent('');

    act(() => { vi.advanceTimersByTime(200); });

    expect(region).toHaveTextContent(/Ada/);
    expect(region).toHaveAttribute('aria-live', 'assertive');
  });

  it('tells the user how to reach the controls, since focus is not moved', () => {
    render(
      <IncomingCallCard callerName="Ada" media={media} onAccept={vi.fn()} onDecline={vi.fn()} />,
    );
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.getByRole('alert')).toHaveTextContent(/Tab/);
  });

  it('still offers Decline before Accept in DOM order', () => {
    render(
      <IncomingCallCard callerName="Ada" media={media} onAccept={vi.fn()} onDecline={vi.fn()} />,
    );

    const buttons: string[] = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const decline: number = buttons.findIndex((t) => /decline/i.test(t));
    const accept: number = buttons.findIndex((t) => /accept|answer/i.test(t));
    expect(decline).toBeGreaterThanOrEqual(0);
    expect(decline).toBeLessThan(accept === -1 ? Infinity : accept);
  });
});
