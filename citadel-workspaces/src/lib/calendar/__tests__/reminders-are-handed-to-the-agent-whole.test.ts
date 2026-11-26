/**
 * The member's reminder plans become the agent's reminders (agent kernel/reminders): one per
 * fire, under the id the browser path uses too, with the time it fires and what it is for. The
 * text is the one the page shows when it fires a reminder itself (`reminderBody`).
 */
import { describe, it, expect } from 'vitest';
import type { AppNotice } from 'citadel-internal-service-wasm-client';
import { CALENDAR_APP_ID } from '../app-id';
import { reminderBody, reminderId, remindersOf } from '../agent-reminders';
import type { ReminderPlan } from '../generated/ReminderPlan';

const plan: ReminderPlan = {
  event_id: 'e1', node: 'workspace-root', title: 'Standup',
  fires: [{ at_ms: 1_800_000_000_000n, start_ms: 1_800_000_600_000n }, { at_ms: 1_800_000_300_000n, start_ms: 1_800_000_600_000n }],
};

describe('the reminders the agent is handed', () => {
  it('are one per fire, under the shared id, with its time as a BigInt', () => {
    const notices: AppNotice[] = remindersOf([plan], (): string => 'body');
    expect(notices.map((n) => n.id)).toEqual(['reminder:e1:1800000000000', 'reminder:e1:1800000300000']);
    expect(notices[0]).toEqual({
      id: reminderId('e1', 1_800_000_000_000n), app_id: CALENDAR_APP_ID, node_id: 'workspace-root', title: 'Standup',
      body: 'body', fire_at_ms: 1_800_000_000_000n, start_ms: 1_800_000_600_000n,
    });
  });

  it('say what the page says when it fires one itself', () => {
    const names = (id: string): string => (id === 'workspace-root' ? 'Team' : '?');
    const [notice] = remindersOf([plan], (due) => reminderBody(due, 'UTC', names));
    expect(notice.body).toBe(reminderBody({ eventId: 'e1', node: 'workspace-root', title: 'Standup', fire: plan.fires[0] }, 'UTC', names));
    expect(notice.body).toMatch(/^Starts at .+ · Team$/);
  });

  it('are none for no plans: a sync without them cancels every reminder', () => {
    expect(remindersOf([], (): string => 'x')).toEqual([]);
  });
});
