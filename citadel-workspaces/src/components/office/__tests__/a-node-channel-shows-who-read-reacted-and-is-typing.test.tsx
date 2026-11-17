/**
 * A node channel shows what a direct chat shows: reactions, read ticks, who is typing, who is
 * there, and reading clears the channel's bell.
 *
 * Before the K1 requests the node chat had none of these: reactions were hidden for want of a
 * request, the tick was always one grey "Sent" because `read_by` existed only in the UI, and the
 * member total was guessed. Here every one of them is the server's answer, counted against the
 * node's roster.
 *
 * MOCKS, and why: only the socket. `@/lib/workspace-service` is the channel-server double, which
 * runs the real request operations, write waiter and response handler, and answers the way the
 * kernel does. The pane, the node transport, the message manager, the channel signals and the
 * notification service are production code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { channelSignals } from '@/lib/group-conversations/channel-signals';
import NotificationService from '@/lib/notification-service';
import { DEFAULT_PRIVACY_SETTINGS, savePrivacySettings } from '@/lib/privacy-settings';
import { channelServer, channelMessage } from '@/lib/chat/transport/__tests__/doubles/channel-server';
import type { ChatSelf } from '@/lib/chat/transport/chat-transport';
import type { User } from '@/types/workspace-entities';
import type { Notification } from '@/lib/notification-service/types';

vi.mock('@/lib/workspace-service', async () => ({
  default: (await import('@/lib/chat/transport/__tests__/doubles/channel-server')).channelServer.service,
}));

const { NodeChat } = await import('../NodeChat');

const CHANNEL: string = 'c0ffee00-0000-4000-8000-000000000003';
const SELF: ChatSelf = { cid: 7n, username: 'ada', displayName: 'Ada Lovelace' };
const member = (username: string, displayName: string, isOnline: boolean | null): User => ({ id: username, username, displayName, isOnline }) as User;
const ROSTER: User[] = [member('ada', 'Ada Lovelace', true), member('bob', 'Bob Byte', true), member('cy', 'Cy Press', false)];

async function open(members: User[] | null): Promise<void> {
  render(
    <ConfirmDialogProvider>
      <NodeChat nodeId="node-design" channelId={CHANNEL} channelName="Design" self={SELF} sendRestriction="allowed" rules={null} members={members} managesSubscription={false} />
    </ConfirmDialogProvider>,
  );
  await screen.findByText('Morning all');
}

const requests = <K extends 'MarkGroupRead' | 'ReactGroupMessage' | 'GroupTyping'>(kind: K): unknown[] =>
  channelServer.requests.filter((r) => r[kind] !== undefined).map((r) => r[kind]);
const row = (text: string): HTMLElement => screen.getByText(text).closest('[data-message-id]') as HTMLElement;

beforeEach((): void => {
  HTMLElement.prototype.scrollTo = function scrollTo(): void {};
  groupMessagingManager.clearAll();
  channelSignals.replaceCursors(CHANNEL, []);
  savePrivacySettings(DEFAULT_PRIVACY_SETTINGS);
  channelServer.reset(CHANNEL, 'ada', []);
  channelServer.reset(CHANNEL, 'ada', [
    channelMessage('m1', 'bob', 'Morning all', 1_700_000_000_000, {}),
    channelMessage('m2', 'ada', 'Hello Bob', 1_700_000_001_000, {}),
  ]);
  channelServer.sessionCid = SELF.cid;
  // The reader is at the keyboard: a read needs the window in front (useP2PMessages-read-gate).
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach((): void => { cleanup(); clearAllDraftsForTests(); vi.restoreAllMocks(); });

describe('a node channel', () => {
  it('ticks your message read once every other member of the roster has read it', async () => {
    channelServer.cursors.set('bob', 'm2');
    await open(ROSTER);
    await userEvent.click(within(row('Hello Bob')).getByTestId('message-status-details-trigger'));
    expect(screen.getByText('Seen by 1 of 2')).toBeInTheDocument();
    expect(within(screen.getByTestId('message-seen-by')).getByText('Bob Byte')).toBeInTheDocument();
    expect(within(row('Hello Bob')).queryByTestId('message-status-read')).toBeNull();

    await act(async (): Promise<void> => { channelServer.moveCursor('cy', 'm2'); });
    await waitFor((): void => { expect(within(row('Hello Bob')).getByTestId('message-status-read')).toBeInTheDocument(); });
    expect(screen.getByText('Seen by 2 of 2')).toBeInTheDocument();
  });

  it('never ticks a message read without the roster to count against', async () => {
    channelServer.cursors.set('bob', 'm2');
    channelServer.cursors.set('cy', 'm2');
    await open(null);
    await userEvent.click(within(row('Hello Bob')).getByTestId('message-status-details-trigger'));
    expect(screen.getByText('Seen by 2')).toBeInTheDocument();
    expect(within(row('Hello Bob')).queryByTestId('message-status-read')).toBeNull();
  });

  it('moves your read cursor to the newest message, and not when you send no receipts', async () => {
    await open(ROSTER);
    await waitFor((): void => { expect(requests('MarkGroupRead')).toEqual([{ group_id: CHANNEL, upto_message_id: 'm2' }]); });

    cleanup();
    groupMessagingManager.clearAll();
    channelServer.reset(CHANNEL, 'ada', [channelMessage('m3', 'bob', 'Morning all', 1_700_000_002_000, {})]);
    savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS, sendReadReceipts: false });
    await open(ROSTER);
    await act(async (): Promise<void> => { await new Promise((r) => setTimeout(r, 50)); });
    expect(requests('MarkGroupRead')).toEqual([]);
  });

  it('moves no cursor while the window is behind', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    await open(ROSTER);
    await act(async (): Promise<void> => { await new Promise((r) => setTimeout(r, 50)); });
    expect(requests('MarkGroupRead')).toEqual([]);
  });

  it('a refused cursor is not taken as written: the next read sends it again', async () => {
    channelServer.refuseCursor = 'You do not have permission to read this channel';
    await open(ROSTER);
    await waitFor((): void => { expect(requests('MarkGroupRead')).toHaveLength(1); });
    channelServer.refuseCursor = null;
    await act(async (): Promise<void> => { channelServer.broadcast(channelMessage('m4', 'bob', 'Still there?', 1_700_000_003_000, {})); });
    await waitFor((): void => { expect(requests('MarkGroupRead')).toContainEqual({ group_id: CHANNEL, upto_message_id: 'm4' }); }, { timeout: 4_000 });
    expect(channelServer.cursors.get('ada')).toBe('m4');
  });

  it('reacts through the server, and a second press takes the reaction back', async () => {
    await open(ROSTER);
    const react = async (): Promise<void> => {
      await userEvent.click(within(row('Morning all')).getByRole('button', { name: /message actions/i }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'React with 👍' }));
    };
    await react();
    await screen.findByTestId('reaction-chip');
    await react();
    await waitFor((): void => { expect(screen.queryByTestId('reaction-chip')).toBeNull(); });
    expect(requests('ReactGroupMessage')).toEqual([
      { group_id: CHANNEL, message_id: 'm1', emoji: '👍', on: true },
      { group_id: CHANNEL, message_id: 'm1', emoji: '👍', on: false },
    ]);
  });

  it('names who is typing until their message arrives, and says who is there', async () => {
    await open(ROSTER);
    expect(screen.getByTestId('node-chat-roster')).toHaveTextContent('3 members, 2 online');
    await act(async (): Promise<void> => { channelServer.typing('bob'); channelServer.typing('ada'); });
    await waitFor((): void => { expect(screen.getByTestId('node-chat-typing')).toHaveTextContent('Bob Byte is typing…'); });
    await act(async (): Promise<void> => { channelServer.broadcast(channelMessage('m5', 'bob', 'Done', 1_700_000_004_000, {})); });
    await waitFor((): void => { expect(screen.getByTestId('node-chat-typing')).toHaveTextContent(''); });
  });

  it('reading the channel clears its bell, and only its own', async () => {
    const bell: ReturnType<typeof NotificationService.getInstance> = NotificationService.getInstance();
    const here: Notification = bell.addMessageNotification('Bob', 'Morning all', 'bob', 'n-here', undefined, { groupId: CHANNEL });
    const elsewhere: Notification = bell.addMessageNotification('Bob', 'Elsewhere', 'bob', 'n-else', undefined, { groupId: 'another-channel' });
    await open(ROSTER);
    await waitFor((): void => { expect(bell.getNotifications().find((n) => n.id === here.id)?.read).toBe(true); });
    expect(bell.getNotifications().find((n) => n.id === elsewhere.id)?.read).toBe(false);
  });
});
