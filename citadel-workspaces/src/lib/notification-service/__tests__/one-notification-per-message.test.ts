/**
 * One notification per message, and never none.
 *
 * An agent that hosts the account raises a native notice for a message
 * (kernel/notices), but only a notifier attached to the agent shows it -- the
 * macOS menu-bar app; Windows has none. So the agent owns a hosted message only
 * with a notifier attached; until the agent says so, the browser owns it.
 *
 * Stand-ins: the agent's capability answer (as a follower asks the leader), the
 * platform's `Notification` constructor, `document.hasFocus`, and the chime --
 * a speaker, which jsdom has none of.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const chimes: { count: number } = vi.hoisted(() => ({ count: 0 }));
vi.mock('../chime', () => ({ playNotificationChime: (): void => { chimes.count += 1; } }));

import { notificationOwner } from '../owner';
import { NotificationType } from '../types';
import { notificationService } from '../service';
import { registerCapabilityRoute, forgetCapabilities, noticesHeard } from '@/lib/agent-conversations/capabilities';

const shown: string[] = [];

/**
 * Absence is proved by order, not by waiting: a browser-owned notification added after
 * the one under test reaches the OS, and the one before it is decided first.
 */
function marker(title: string): void { notificationService.addSystemNotification(title, 'x'); }

/** A follower's view: the leader says what its agent hosts, and whether a notifier is attached. */
function agentHosts(agentIlm: boolean, noticesHeard: boolean): void {
  forgetCapabilities();
  registerCapabilityRoute({ isLeader: () => false, askLeader: async () => ({ agentIlm, supervisesP2p: false, stagesUploads: false, takesConsole: false, servesApps: false, noticesHeard }) });
}


beforeEach(() => {
  shown.length = 0;
  chimes.count = 0;
  vi.stubGlobal('Notification', class { static permission: NotificationPermission = 'granted'; constructor(title: string) { shown.push(title); } });
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker'); forgetCapabilities(); });

describe('who owns a notification', () => {
  const p2p: { type: NotificationType; data: Record<string, unknown> } = { type: NotificationType.MESSAGE, data: { peerCid: '9' } };
  it('a hosted conversation\'s message is the agent\'s when a notifier is attached to it', () => {
    expect(notificationOwner(p2p, { hostsConversations: true, notifierAttached: true })).toBe('agent');
  });
  it('the browser\'s when nothing on the agent\'s side would show it (Windows has no notifier)', () => {
    expect(notificationOwner(p2p, { hostsConversations: true, notifierAttached: false })).toBe('browser');
  });
  it('the browser\'s without a hosting agent', () => {
    expect(notificationOwner(p2p, { hostsConversations: false, notifierAttached: true })).toBe('browser');
  });
  it('what the agent does not host stays the browser\'s', () => {
    const both: { hostsConversations: boolean; notifierAttached: boolean } = { hostsConversations: true, notifierAttached: true };
    expect(notificationOwner({ type: NotificationType.MESSAGE, data: { groupId: 'g' } }, both)).toBe('browser');
    expect(notificationOwner({ type: NotificationType.SYSTEM }, both)).toBe('browser');
  });
});

describe('a message for a window that is not in front', () => {
  // A hosted message the browser stayed silent for reached nobody on Windows, and
  // reaches nobody on any platform until the agent says a notifier is attached.
  it('still reaches the OS, with its chime, when the agent hosts the conversation', async () => {
    agentHosts(true, false);
    notificationService.addMessageNotification('Alice', 'hi', '9', 'owned-1', '5', { peerCid: '9' });
    await vi.waitFor(() => expect(shown).toEqual(['Alice']));
    expect(chimes.count).toBe(1);
  });

  it('is left to the agent when a notifier is attached to it: one notification, not two', async () => {
    agentHosts(true, true);
    notificationService.addMessageNotification('Hosted', 'hi', '9', 'owned-3', '5', { peerCid: '9' });
    marker('Marker');
    await vi.waitFor(() => expect(shown).toEqual(['Marker']));
    expect(chimes.count).toBe(1);
  });

  it('reaches the OS again once the agent says its notifier went away', async () => {
    agentHosts(true, true);
    notificationService.addMessageNotification('Before', 'hi', '9', 'owned-4', '5', { peerCid: '9' });
    marker('Marker');
    await vi.waitFor(() => expect(shown).toEqual(['Marker']));
    noticesHeard.set(false);
    notificationService.addMessageNotification('After', 'again', '9', 'owned-5', '5', { peerCid: '9' });
    await vi.waitFor(() => expect(shown).toEqual(['Marker', 'After']));
  });
});

describe('whether the window is in front', () => {
  it('is read when the notification arrives, not when its delivery has loaded', async () => {
    agentHosts(false, false);
    notificationService.addMessageNotification('Behind', 'hi', '9', 'front-1', '5', { peerCid: '9' });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    notificationService.addMessageNotification('InFront', 'hi', '9', 'front-2', '5', { peerCid: '9' });
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    marker('Marker');
    await vi.waitFor(() => expect(shown).toEqual(['Behind', 'Marker']));
  });
});

describe('a message for a window that is not in front, without an agent that hosts', () => {
  it('reaches the OS, with its chime, when the browser runs messaging', async () => {
    agentHosts(false, false);
    notificationService.addMessageNotification('Alice', 'hi', '9', 'owned-2', '5', { peerCid: '9' });
    await vi.waitFor(() => expect(shown).toEqual(['Alice']));
    expect(chimes.count).toBe(1);
  });
});
