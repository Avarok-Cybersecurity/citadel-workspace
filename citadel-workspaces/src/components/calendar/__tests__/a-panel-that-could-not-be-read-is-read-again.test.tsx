/**
 * A Calendar panel whose data could not be read says what and why, and Try again reads it again
 * (RECOVERY-DESIGN.md §1 item 9): the panel is not a dead end. Over the real ports and store; the
 * one stand-in is a storage read that is refused once, which the memory store cannot be made to do
 * (a refusal it gives is for good, so it could never show the second read succeeding).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { member, TopicGroup, treeOf } from '@/lib/calendar/__tests__/tree-rig';
import { PortRefused, type CalendarPorts, type CalendarStore } from '@/lib/calendar/ports';
import { CalendarNotifications } from '../CalendarNotifications';

/** `ports` whose next `times` storage reads are refused as unavailable. */
function refusedFor(ports: CalendarPorts, times: number): CalendarPorts {
  let left: number = times;
  return {
    ...ports,
    storage: {
      ...ports.storage,
      get: (store: CalendarStore, key: string): Promise<Uint8Array | null> => {
        if (left > 0) {
          left -= 1;
          return Promise.reject(new PortRefused('KvGet', { unavailable: 'the agent is busy' }));
        }
        return ports.storage.get(store, key);
      },
    },
  };
}

describe('a Calendar panel that could not be read', () => {
  afterEach((): void => { cleanup(); });

  it('says what and why, and Try again reads it again', async () => {
    const amy: CalendarPorts = member('amy', new Map(), treeOf({ a: null }), new TopicGroup()).ports;
    render(<CalendarNotifications ports={refusedFor(amy, 1)} />);
    const notice: HTMLElement = await screen.findByRole('alert');
    expect(notice.textContent).toContain('Your notification settings could not be read: it is not available right now (the agent is busy).');
    await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(await screen.findByTestId('calendar-notify-settings')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
