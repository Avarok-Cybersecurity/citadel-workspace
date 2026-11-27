/**
 * A system notification says only what the account's message-preview setting allows, for every
 * kind the browser shows (os-preview.ts), by the agent's rule (kernel/notices/decide.rs).
 * Under `SenderOnly` -- the default -- a message's text and the words in someone else's app
 * notice stay off the lock screen; the browser showed them regardless, because only the agent
 * applied the setting. The member's own reminders keep their title.
 *
 * Pure rule per kind, then end to end through the real notification service and delivery.
 * Stand-ins: the agent's preference answer (requests.ts; no agent in CI), and the browser's
 * Notification API (fake-notification-api.ts; the OS cannot be driven in CI).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountPreferences, NotificationPreview } from 'citadel-internal-service-wasm-client';
import { HIDDEN_MESSAGE_TEXT, osContent, type OsContent } from '../os-preview';
import { NotificationPriority, NotificationType, type Notification } from '../types';
import { installFakeNotificationApi, type FakeNotificationApi } from './fake-notification-api';

const prefs: { answer: NotificationPreview | 'fails' } = vi.hoisted(() => ({ answer: 'SenderOnly' as NotificationPreview | 'fails' }));
vi.mock('@/lib/agent-conversations/requests', () => ({
  agentConversations: {
    getPreferences: async (): Promise<AccountPreferences> => {
      if (prefs.answer === 'fails') throw new Error('no agent');
      return { notification_preview: prefs.answer } as AccountPreferences;
    },
  },
}));

const { notificationService } = await import('../service');

type Kind = Pick<Notification, 'type' | 'title' | 'content' | 'data'>;
const KINDS: Readonly<Record<string, { n: Kind; senderOnly: OsContent }>> = {
  'a one-to-one message': {
    n: { type: NotificationType.MESSAGE, title: 'New message from Ada', content: 'the vault code is 4411', data: { peerCid: '9' } },
    senderOnly: { title: 'New message from Ada', body: HIDDEN_MESSAGE_TEXT },
  },
  'a group message': {
    n: { type: NotificationType.MESSAGE, title: 'Ada', content: 'salaries attached', data: { groupId: 'g-1' } },
    senderOnly: { title: 'Ada', body: HIDDEN_MESSAGE_TEXT },
  },
  'a connection request': {
    n: { type: NotificationType.PEER_REGISTRATION, title: 'Ada wants to connect', content: '@ada' },
    senderOnly: { title: 'Ada wants to connect', body: '@ada' },
  },
  "an app notice with someone else's words": {
    n: { type: NotificationType.SYSTEM, title: 'Invitation: layoffs review', content: 'Fri 9:00', data: { appId: 'net.avarok.calendar', senderLine: 'Calendar: new invitation' } },
    senderOnly: { title: 'Calendar: new invitation', body: '' },
  },
  'your own reminder': {
    n: { type: NotificationType.SYSTEM, title: 'Design review', content: 'Starts at 2:00 PM', data: { appId: 'net.avarok.calendar' } },
    senderOnly: { title: 'Design review', body: 'Starts at 2:00 PM' },
  },
};

describe('what a system notification says', () => {
  for (const [name, { n, senderOnly }] of Object.entries(KINDS)) {
    it(`${name}: who, not what, under SenderOnly`, () => { expect(osContent(n, 'SenderOnly')).toEqual(senderOnly); });
    it(`${name}: everything, once previews are on`, () => { expect(osContent(n, 'Text')).toEqual({ title: n.title, body: n.content }); });
  }
});

describe('a message shown by the browser', () => {
  let api: FakeNotificationApi;
  beforeEach(() => {
    api = installFakeNotificationApi('granted');
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker'); });

  const send = (text: string): void => {
    notificationService.addMessageNotification('New message from Ada', text, '9', `m-${text}`, '5', { peerCid: '9' });
  };

  it('keeps its text off the lock screen under the default setting', async () => {
    prefs.answer = 'SenderOnly';
    send('the vault code is 4411');
    await vi.waitFor(() => expect(api.bodies).toEqual([HIDDEN_MESSAGE_TEXT]));
    expect(api.shown).toEqual(['New message from Ada']);
  });

  it('shows its text once the member turned previews on (opposite direction)', async () => {
    prefs.answer = 'Text';
    send('see you at 5');
    await vi.waitFor(() => expect(api.bodies).toEqual(['see you at 5']));
  });

  it('fails closed when the setting cannot be read', async () => {
    prefs.answer = 'fails';
    vi.spyOn(console, 'warn').mockImplementation((): void => undefined);
    notificationService.addNotification({ type: NotificationType.MESSAGE, priority: NotificationPriority.NORMAL, title: 'Ada', content: 'private', recipient_cid: '5', data: { groupId: 'g' }, osReach: 'when-away' });
    await vi.waitFor(() => expect(api.bodies).toEqual([HIDDEN_MESSAGE_TEXT]));
  });
});
