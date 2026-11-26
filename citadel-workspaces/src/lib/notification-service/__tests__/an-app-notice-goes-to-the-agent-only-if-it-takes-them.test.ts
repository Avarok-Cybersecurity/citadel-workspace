/**
 * An app's notice (a Calendar invitation) is handed to the agent to show natively only when the
 * agent says it takes app notices (`AgentCapabilities.app_notices`) and something on its side
 * shows them. An older agent does not say, so the browser shows it; a refusal does the same. One
 * OS notification, never none.
 *
 * The declaration runs for real over a fake socket that answers as each agent would. Stand-ins:
 * the request to the agent (`postAppNotice`, the socket edge), the platform's `Notification`,
 * `document.hasFocus`, and the chime, a speaker jsdom has none of.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InternalServiceRequest, InternalServiceResponse } from 'citadel-workspace-client-ts';

const agent: { posted: string[]; refuses: boolean } = vi.hoisted(() => ({ posted: [], refuses: false }));
vi.mock('../chime', () => ({ playNotificationChime: (): void => undefined }));
vi.mock('@/lib/agent-apps/app-notice-requests', () => ({
  postAppNotice: async (_cid: bigint, notice: { title: string }): Promise<void> => {
    agent.posted.push(notice.title);
    if (agent.refuses) throw new Error('Unheard');
  },
}));

import { notificationOwner } from '../owner';
import { appNoticeOf } from '../agent-app-notice';
import { NotificationPriority, NotificationType, type Notification } from '../types';
import { notificationService } from '../service';
import {
  appNotices, declareOnLeaderSocket, forgetCapabilities, registerCapabilityRoute, watchGreeting, type DeclaringClient, type Greeting,
} from '@/lib/agent-conversations/capabilities';

const shown: string[] = [];

/** A leader whose agent answers its declaration with `fields`. */
async function agentAnswers(fields: Record<string, unknown>): Promise<void> {
  forgetCapabilities();
  registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
  let settle: ((v: unknown) => void) | null = null;
  let match: ((m: InternalServiceResponse) => unknown) | null = null;
  const client: DeclaringClient = {
    async sendDirectToInternalService(request: InternalServiceRequest): Promise<void> {
      const id: unknown = (request as { ConnectionManagement: { request_id: string } }).ConnectionManagement.request_id;
      settle?.(match?.({ AgentCapabilities: { request_id: id, ...fields } } as unknown as InternalServiceResponse));
    },
    nextResponse<T>(extract: (m: InternalServiceResponse) => T | undefined): Promise<T> {
      match = extract;
      return new Promise<T>((resolve) => { settle = resolve as (v: unknown) => void; });
    },
  };
  const greeting: Greeting = watchGreeting();
  greeting.observe({ ServiceConnectionAccepted: { cid: 0n, request_id: null } });
  await declareOnLeaderSocket(client, greeting);
}

function appNotice(title: string): void {
  notificationService.addNotification({
    type: NotificationType.SYSTEM, priority: NotificationPriority.NORMAL, title, content: 'Starts at 10:00', senderName: 'Calendar',
    recipient_cid: '5', data: { appId: 'net.avarok.calendar', nodeId: 'workspace-root', senderLine: null },
    osReach: 'always',
  });
}

beforeEach(() => {
  shown.length = 0;
  agent.posted.length = 0;
  agent.refuses = false;
  vi.stubGlobal('Notification', class { static permission: NotificationPermission = 'granted'; constructor(title: string) { shown.push(title); } });
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker'); forgetCapabilities(); });

describe('who owns an app notice', () => {
  const page: { type: NotificationType; data: Record<string, unknown> } = { type: NotificationType.SYSTEM, data: { appId: 'net.avarok.calendar', nodeId: 'n' } };
  it('the agent is handed it when it takes app notices and something shows them', () => {
    expect(notificationOwner(page, { notifierAttached: true, appNotices: true })).toBe('hand-to-agent');
  });
  it('the browser keeps it when the agent does not take app notices, or nothing shows them', () => {
    expect(notificationOwner(page, { notifierAttached: true, appNotices: false })).toBe('browser');
    expect(notificationOwner(page, { notifierAttached: false, appNotices: true })).toBe('browser');
  });
  it('one the agent fired itself is never handed back', () => {
    const fromAgent: typeof page = { ...page, data: { ...page.data, fromAgent: true } };
    expect(notificationOwner(fromAgent, { notifierAttached: true, appNotices: true })).toBe('browser');
  });
});

describe('an app notice for a window that is not in front', () => {
  it('reaches the browser from an older agent, which does not say it takes app notices', async () => {
    await agentAnswers({ notices_heard: true });
    expect(appNotices.get()).toBe(false);
    appNotice('Old');
    await vi.waitFor(() => expect(shown).toEqual(['Old']));
    expect(agent.posted).toEqual([]);
  });

  it('is shown by an agent that takes them, and not by the browser too', async () => {
    await agentAnswers({ notices_heard: true, app_notices: true });
    appNotice('Native');
    await vi.waitFor(() => expect(agent.posted).toEqual(['Native']));
    notificationService.addSystemNotification('Marker', 'x');
    await vi.waitFor(() => expect(shown).toEqual(['Marker']));
  });

  it('reaches the browser after all when the agent refuses it', async () => {
    await agentAnswers({ notices_heard: true, app_notices: true });
    agent.refuses = true;
    appNotice('Refused');
    await vi.waitFor(() => expect(shown).toEqual(['Refused']));
    expect(agent.posted).toEqual(['Refused']);
  });
});

describe('what the agent is handed', () => {
  const invitation: Pick<Notification, 'id' | 'title' | 'content' | 'data'> = { id: 'n1', title: 'Invitation: Salary review', content: 'From bob, Friday', data: { appId: 'net.avarok.calendar', nodeId: 'workspace-root', senderLine: 'Calendar: new invitation from bob' } };
  it('names the sender line the host wrote for it', () => {
    expect(appNoticeOf(invitation)?.sender_only).toBe('Calendar: new invitation from bob');
  });
  it('names none for the app\'s own notice, which the host wrote no sender line for: its title shows', () => {
    expect(appNoticeOf({ ...invitation, data: { appId: 'net.avarok.calendar', nodeId: 'workspace-root', senderLine: null } })?.sender_only).toBeUndefined();
  });
  it('is nothing for a notice that names no app', () => {
    expect(appNoticeOf({ ...invitation, data: { nodeId: 'workspace-root', senderLine: null } })).toBeNull();
  });
});
