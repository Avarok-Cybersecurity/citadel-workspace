/**
 * The member's Calendar notification settings, from the Calendar's own "Notifications" panel,
 * over the real core, ports, gate and store: each change is saved to the member's own storage as
 * it is made and read back as chosen; the preview follows the choices; turning the Calendar off
 * stills every option; and a new event starts with the reminders the member chose.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContext, type WorkspaceState } from '@/contexts/WorkspaceContext';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { decodePrefs, type NotifyPrefs } from '@/lib/calendar/notify-prefs';
import { realEngine } from '@/lib/calendar/__tests__/engine-rig';
import { member, TopicGroup, treeOf, type Member } from '@/lib/calendar/__tests__/tree-rig';
import { CalendarPane } from '../CalendarPane';
import type { TreeNode } from '@/lib/citadel-apps/runtime/nodes-port';

const engine: CalendarEngine = realEngine();
const TREE: Record<string, TreeNode> = treeOf({ a: null });

beforeEach((): void => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-07-16T15:00:00Z'));
});
afterEach((): void => { vi.useRealTimers(); });

function opened(): Map<string, Uint8Array> {
  const values: Map<string, Uint8Array> = new Map();
  const amy: Member = member('amy', values, TREE, new TopicGroup());
  const state: WorkspaceState = { nodes: TREE, members: {}, workspace: { metadata: [] } } as unknown as WorkspaceState;
  render(
    <WorkspaceContext.Provider value={{ state }}>
      <CalendarPane ports={amy.ports} engine={engine} nodeId="a" me="amy" displayZone="America/New_York" deviceZone="America/New_York" held={new Set()} mayEditNode />
    </WorkspaceContext.Provider>,
  );
  return values;
}

const kept = (values: Map<string, Uint8Array>): NotifyPrefs | null => {
  const bytes: Uint8Array | undefined = values.get('user:amy|cal/settings/notifications');
  return bytes === undefined ? null : decodePrefs(bytes);
};

async function panel(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  return screen.findByTestId('calendar-notify-settings');
}

describe("the Calendar's notification settings", () => {
  it('save each change to the member and read it back as chosen', async () => {
    const values: Map<string, Uint8Array> = opened();
    const form: HTMLElement = await panel();
    expect(within(form).getByText(/Not set yet/)).toBeTruthy();
    await act(async () => { fireEvent.click(within(form).getByLabelText(/^Bookings/)); });
    await vi.waitFor(() => expect(kept(values)?.kinds.bookings).toBe(false));
    await act(async () => { fireEvent.click(within(form).getByLabelText(/^In Citadel only/)); });
    await vi.waitFor(() => expect(kept(values)?.delivery).toBe('in_app'));
    await act(async () => { fireEvent.click(within(form).getByLabelText('30 minutes before')); });
    await vi.waitFor(() => expect(kept(values)).toEqual({ enabled: true, kinds: { reminders: true, invitations: true, bookings: false, polls: true }, leadMinutes: [30], delivery: 'in_app' }));
    expect(within(screen.getByTestId('calendar-notify-preview')).getByText('Shown in the bell only.')).toBeTruthy();
  });

  it('turned off, still every option and say nothing will be reminded', async () => {
    const values: Map<string, Uint8Array> = opened();
    const form: HTMLElement = await panel();
    await act(async () => { fireEvent.click(within(form).getByRole('switch', { name: 'Calendar notifications' })); });
    await vi.waitFor(() => expect(kept(values)?.enabled).toBe(false));
    expect(within(form).getByLabelText(/^Invitations/).matches(':disabled')).toBe(true);
    expect(within(screen.getByTestId('calendar-notify-preview')).getByText('You will not be reminded of your events.')).toBeTruthy();
  });

  it('start a new event with the reminders the member chose', async () => {
    opened();
    const form: HTMLElement = await panel();
    await act(async () => { fireEvent.click(within(form).getByLabelText('1 hour before')); });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the calendar' }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'New' })); });
    const editor: HTMLElement = await screen.findByTestId('calendar-event-editor');
    expect((within(editor).getByLabelText('1 hour before') as HTMLInputElement).checked).toBe(true);
    expect((within(editor).getByLabelText('10 minutes before') as HTMLInputElement).checked).toBe(false);
  });
});
