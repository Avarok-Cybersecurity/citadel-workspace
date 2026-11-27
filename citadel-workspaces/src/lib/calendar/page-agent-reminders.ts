/**
 * The window's side of the agent's reminders (calendar-background.ts `AgentReminders`): whether
 * the agent takes app notices (capabilities.ts `appNotices`, which every new socket answers
 * again), the session's reminders handed to it, and the reminders it fired listed in the bell.
 */
import type { AppNotice, AppNoticeNotification } from 'citadel-internal-service-wasm-client';
import { appNotices } from '@/lib/agent-conversations/capabilities';
import { eventEmitter } from '@/lib/event-emitter';
import { notificationService } from '@/lib/notification-service/service';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { syncRemindersToAgent } from './agent-reminders';
import type { AgentReminders } from './calendar-background';
import { firedReminderEntry, firedReminderOf } from './fired-reminders';

export function pageAgentReminders(appName: string): AgentReminders {
  return {
    takes: (): boolean => appNotices.get(),
    onTakesChange: (listener: () => void): (() => void) => appNotices.subscribe(listener),
    sync: async (notices: readonly AppNotice[]): Promise<void> => {
      const cid: bigint | null = await getCurrentCid();
      if (cid === null) throw new Error('no session is signed in to hand the reminders to');
      await syncRemindersToAgent(cid, notices);
    },
    listFired: (): (() => void) => eventEmitter.on('websocket-message', (message: unknown): void => {
      const fired: AppNoticeNotification | null = firedReminderOf(message);
      if (fired === null) return;
      getCurrentCid().then((cid: bigint | null): void => {
        // Another session's, in a window of this browser that does not act as it.
        if (cid !== fired.cid) return;
        notificationService.addNotification(firedReminderEntry(fired, appName));
      }, (e: unknown): void => { console.error('[calendar] a reminder the agent fired could not be listed', e); });
    }),
  };
}
