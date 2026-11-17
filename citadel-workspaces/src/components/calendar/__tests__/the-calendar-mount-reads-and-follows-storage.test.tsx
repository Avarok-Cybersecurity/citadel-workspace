/**
 * The Calendar as its tab mounts it, over the real core, the real ports and gate, and an in-memory
 * store: with no settings it asks for a zone once and keeps the answer; with settings it shows the
 * node's events; and when the kernel says one of the node's keys changed, it reads that source
 * again, so an event another member posted appears without a reload.
 *
 * One module is replaced: jsdom cannot fetch the core's binary from its URL, so the loader hands
 * back the same vendored glue initialised from the committed file (engine-rig.ts does the same).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { GlueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { event, realEngine } from '@/lib/calendar/__tests__/engine-rig';
import { decodeSettings, encodeSettings, SETTINGS_KEY } from '@/lib/calendar/zones';
import { mountCalendar, mountRig, type MountRig } from './mount-rig';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type * as CalendarGlue from '../../../../vendor/calendar/calendar_glue.js';

vi.mock('@/lib/calendar/engine/load-calendar-wasm', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const glue: typeof CalendarGlue = await import('../../../../vendor/calendar/calendar_glue.js');
  return {
    loadCalendarWasm: async (): Promise<typeof CalendarGlue> => {
      glue.initSync({ module: readFileSync(join(process.cwd(), 'public/calendar/calendar_glue_bg.wasm')) });
      return glue;
    },
  };
});

const engine: CalendarEngine = realEngine();
const rig = (): MountRig => mountRig('amy');
const mount = (glue: GlueInstance): void => mountCalendar(glue, 'amy', false);

const chipTitles = (): string[] => screen.queryAllByTestId('calendar-event-chip').map((c) => (c.getAttribute('aria-label') ?? '').split(',')[0] as string);

beforeEach((): void => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2024-07-16T15:00:00Z')); });
afterEach((): void => { vi.useRealTimers(); });

describe('the Calendar tab, mounted', () => {
  it('asks which zone to show once, and keeps the answer in the member\'s own settings', async () => {
    const { store, glue } = rig();
    mount(glue);
    await screen.findByTestId('calendar-zone-question');
    fireEvent.click(screen.getByLabelText('Always use one zone'));
    fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'America/Chicago' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show my Calendar' }));
    await screen.findByTestId('calendar-tab');
    const saved: Uint8Array | undefined = store.values.get(store.where('user', SETTINGS_KEY, false));
    expect(saved === undefined ? null : decodeSettings(saved)).toEqual({ displayZone: { kind: 'fixed', zone: 'America/Chicago' } });
  });

  it("shows the node's events, and reads them again when one of its keys changes", async () => {
    const { store, glue, change } = rig();
    store.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/New_York' } }));
    store.put({ node: { node_id: 'n1' } }, 'cal/event/a', engine.encodeEvent(event({ id: 'a', title: 'Standup' })));
    mount(glue);
    await waitFor(() => expect(chipTitles()).toEqual(['Standup']));
    store.put({ node: { node_id: 'n1' } }, 'cal/event/b', engine.encodeEvent(event({ id: 'b', title: 'Retro' })));
    expect(chipTitles()).toEqual(['Standup']);
    act((): void => change({ backend: { node: { node_id: 'n1' } }, key: 'cal/event/b' }));
    await waitFor(() => expect(chipTitles().sort()).toEqual(['Retro', 'Standup']));
  });
});
