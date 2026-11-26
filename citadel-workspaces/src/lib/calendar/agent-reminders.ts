/**
 * The member's reminders handed to the agent, which fires them itself, with no window open
 * (agent kernel/reminders), when it takes app notices (`appNotices`, capabilities.ts). The plans
 * stay the member's (`cal/reminders/<event_id>`); the agent is told the whole set after each
 * change and on every connect, and keeps only the times. A reminder's id is the same on both
 * paths (`reminderId`), so a reminder already fired is never fired twice.
 */
import type { AppNotice } from 'citadel-internal-service-wasm-client';
import { syncAppReminders } from '@/lib/agent-apps/app-notice-requests';
import { CALENDAR_APP_ID } from './app-id';
import { formatTimeIn } from './format';
import type { ReminderPlan } from './generated/ReminderPlan';
import type { Due } from './reminder-scheduler';

/** One reminder's id, shared with the browser path (its notification `tag`). */
export function reminderId(eventId: string, atMs: bigint): string {
  return `reminder:${eventId}:${atMs.toString()}`;
}

/** What a reminder says under its title, in `zone`, wherever it is shown. */
export function reminderBody(due: Due, zone: string, nodeName: (id: string) => string): string {
  return `Starts at ${formatTimeIn(due.fire.start_ms, zone)} · ${nodeName(due.node)}`;
}

/** Every fire of every plan, as the agent keeps it. */
export function remindersOf(plans: readonly ReminderPlan[], bodyOf: (due: Due) => string): AppNotice[] {
  return plans.flatMap((plan: ReminderPlan): AppNotice[] => plan.fires.map((fire): AppNotice => ({
    id: reminderId(plan.event_id, fire.at_ms),
    app_id: CALENDAR_APP_ID,
    node_id: plan.node,
    title: plan.title,
    body: bodyOf({ eventId: plan.event_id, node: plan.node, title: plan.title, fire }),
    // The member's own event: its title shows whatever the preview setting.
    sender_only: undefined,
    fire_at_ms: fire.at_ms,
    start_ms: fire.start_ms,
  })));
}

/** Replace session `cid`'s reminders on the agent with `plans`; rejects with `AgentNoticeRefused`. */
export function syncRemindersToAgent(cid: bigint, plans: readonly ReminderPlan[], bodyOf: (due: Due) => string): Promise<void> {
  return syncAppReminders(cid, CALENDAR_APP_ID, remindersOf(plans, bodyOf));
}
