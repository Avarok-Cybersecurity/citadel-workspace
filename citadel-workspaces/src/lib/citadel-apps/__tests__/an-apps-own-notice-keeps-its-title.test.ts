/**
 * With previews off (`SenderOnly`), a notice with no `kind` is the app's own to its member and
 * keeps its title; one with a `kind` may carry someone else's words and says only its sender line.
 * Both ways out of the page agree: what the browser shows (os-preview.ts) and what the agent is
 * handed to show (agent-app-notice.ts `appNoticeOf`, whose `sender_only` the agent shows instead,
 * kernel/notices/decide.rs).
 *
 * Real host decoding (op-args.ts), port (first-party-ports.ts), list entry (app-notices.ts) and
 * both rules; no stand-ins.
 */
import { describe, expect, it } from 'vitest';
import type { AppNotice } from 'citadel-internal-service-wasm-client';
import { parseArgs } from '../host/op-args';
import { badgedNotifyPort, type AppNoticeEntry } from '../runtime/first-party-ports';
import { toldAuthors } from '../runtime/told-authors';
import { appNoticeNotification } from '../app-notices';
import type { Notify } from '../sdk/generated/Notify';
import { osContent, type OsContent } from '@/lib/notification-service/os-preview';
import { appNoticeOf } from '@/lib/notification-service/agent-app-notice';
import type { Notification } from '@/lib/notification-service/types';

/** A call as the guest sent it, through the host's decoding, to the entry the page lists. */
function listed(app: string, args: Record<string, unknown>): Notification {
  const decoded: unknown = parseArgs('Notify', args);
  if (decoded === null) throw new Error('the host refused the call');
  const seen: AppNoticeEntry[] = [];
  void badgedNotifyPort({ id: `x.${app}`, name: app, nodeId: 'n-1' }, (n: AppNoticeEntry): void => { seen.push(n); }, toldAuthors().authorOf).Notify(decoded as Notify);
  return { ...appNoticeNotification(seen[0], 5n), id: 'e-1', timestamp: 0, read: false };
}

const handed = (n: Notification): AppNotice => {
  const notice: AppNotice | null = appNoticeOf(n);
  if (notice === null) throw new Error('nothing was handed to the agent');
  return notice;
};

const CASES: ReadonlyArray<{ name: string; app: string; args: Record<string, unknown>; browser: OsContent; agentSenderOnly: string | undefined }> = [
  {
    name: 'a Calendar reminder, which names no kind, keeps its title',
    app: 'Calendar', args: { title: 'Design review', body: 'Starts at 2:00 PM' },
    browser: { title: 'Design review', body: 'Starts at 2:00 PM' }, agentSenderOnly: undefined,
  },
  {
    name: 'an invitation says only its sender line',
    app: 'Calendar', args: { title: 'Invitation: layoffs review', body: 'Fri 9:00', kind: 'invitation' },
    browser: { title: 'Calendar: new invitation', body: '' }, agentSenderOnly: 'Calendar: new invitation',
  },
  {
    name: 'an app on the old notify(title, body) shows what it showed before',
    app: 'Board', args: { title: 'Card moved', body: 'Done column' },
    browser: { title: 'Card moved', body: 'Done column' }, agentSenderOnly: undefined,
  },
];

describe('under SenderOnly, an app notice', () => {
  for (const c of CASES) {
    it(`${c.name}, in the browser`, () => { expect(osContent(listed(c.app, c.args), 'SenderOnly')).toEqual(c.browser); });
    it(`${c.name}, through the agent`, () => {
      const notice: AppNotice = handed(listed(c.app, c.args));
      expect(notice.sender_only).toBe(c.agentSenderOnly);
      expect([notice.title, notice.body]).toEqual([c.args.title, c.args.body]);
    });
  }
});
