/**
 * An office's or room's chat is the direct chat's pane, over the node channel.
 *
 * The node chat was GroupChatView: a plain box that sent only text, waited for the server's copy
 * before showing your message, dropped your text when the server refused it, said "Replying to
 * message..." without the message, and paged with a button. It is now the same pane as a direct
 * chat, so each of those is the direct chat's behaviour, and these tests drive it as a person
 * would.
 *
 * MOCKS, and why: only the socket. `@/lib/workspace-service` is the channel-server double, which
 * runs the real messaging operations, write waiter and response handler, and answers the way the
 * kernel does. The pane, its hooks, the node transport and the message manager are production code.
 * jsdom has no layout, so `scrollTo` (which the pane calls to follow your own message) is a no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { channelServer, channelMessage } from '@/lib/chat/transport/__tests__/doubles/channel-server';
import type { ChatSelf } from '@/lib/chat/transport/chat-transport';
import type { GroupMessage } from '@/types/workspace-entities';
import type { GroupRestriction } from '@/components/chat/group-restriction';

vi.mock('@/lib/workspace-service', async () => ({
  default: (await import('@/lib/chat/transport/__tests__/doubles/channel-server')).channelServer.service,
}));

const { NodeChat } = await import('../NodeChat');

const CHANNEL: string = 'c0ffee00-0000-4000-8000-000000000001';
const SELF: ChatSelf = { cid: 7n, username: 'ada', displayName: 'Ada Lovelace' };

function chat(restriction: GroupRestriction): JSX.Element {
  return (
    <ConfirmDialogProvider>
      <NodeChat nodeId="node-design" channelId={CHANNEL} channelName="Design" self={SELF} sendRestriction={restriction} rules="Be kind." members={null} managesSubscription={false} />
    </ConfirmDialogProvider>
  );
}

async function open(): Promise<ReturnType<typeof render>> {
  const view: ReturnType<typeof render> = render(chat('allowed'));
  await screen.findByText('Morning all');
  return view;
}

const sent = (): unknown[] => channelServer.requests.filter((r) => r.SendGroupMessage !== undefined).map((r) => r.SendGroupMessage);
const bubbles = (text: string): HTMLElement[] => screen.queryAllByText(text);

async function type(text: string): Promise<void> {
  fireEvent.change(screen.getByTestId('group-message-input'), { target: { value: text } });
  await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })); });
}

beforeEach((): void => {
  HTMLElement.prototype.scrollTo = function scrollTo(): void {};
  groupMessagingManager.clearAll();
  // Reset first with no messages, so the fixtures below take this channel's id.
  channelServer.reset(CHANNEL, 'ada', []);
  channelServer.reset(CHANNEL, 'ada', [
    channelMessage('m1', 'bob', 'Morning all', 1_700_000_000_000, {}),
    channelMessage('m2', 'ada', 'Hello Bob', 1_700_000_001_000, {}),
  ]);
});
afterEach((): void => { cleanup(); clearAllDraftsForTests(); });

describe('a node channel', () => {
  it('shows its stored history with each other sender named, and its rules', async () => {
    await open();
    expect(screen.getByText('bob')).toBeInTheDocument();
    // The reader's own message carries no name over it, as in a direct chat.
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
    expect(screen.getByTestId('channel-rules')).toHaveTextContent('Be kind.');
  });

  it('offers markdown, live documents and files, saying where a file is kept', async () => {
    await open();
    expect(screen.getByTestId('message-type-markdown')).toBeInTheDocument();
    expect(screen.getByTestId('message-type-live-doc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send file' })).toBeInTheDocument();
    expect(screen.getByTestId('attach-destination')).toHaveTextContent("Stored on the workspace server, readable by this channel's members");
  });

  it('sends markdown as the wire\'s Markdown type', async () => {
    await open();
    fireEvent.click(screen.getByTestId('message-type-markdown'));
    await type('**ship it**');
    await waitFor((): void => { expect(sent()).toEqual([expect.objectContaining({ content: '**ship it**', message_type: 'Markdown' })]); });
  });

  it('shows your own message before the server\'s copy, and then once', async () => {
    await open();
    channelServer.nextSend = { kind: 'hold' };
    await type('On my way');
    expect(bubbles('On my way')).toHaveLength(1);
    expect(screen.getByTestId('group-message-input')).toHaveValue('');
    await act(async (): Promise<void> => { channelServer.release(); });
    await waitFor((): void => { expect(groupMessagingManager.getMessages(CHANNEL).messages.map((m) => m.content)).toContain('On my way'); });
    expect(bubbles('On my way')).toHaveLength(1);
  });

  it('keeps a refused message with the reason, and resends it on Retry', async () => {
    await open();
    channelServer.nextSend = { kind: 'refuse', reason: 'Please slow down' };
    await type('Too fast');
    await screen.findByText('Please slow down');
    expect(screen.getByText('Failed to send')).toBeInTheDocument();
    channelServer.nextSend = { kind: 'store' };
    await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor((): void => { expect(screen.queryByText('Failed to send')).toBeNull(); });
    expect(bubbles('Too fast')).toHaveLength(1);
    expect(sent()).toHaveLength(2);
  });

  it('quotes the message a reply answers, and sends the reply with it', async () => {
    await open();
    const theirs: HTMLElement = screen.getByText('Morning all').closest('[data-message-id]') as HTMLElement;
    await userEvent.click(within(theirs).getByRole('button', { name: /message actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^reply$/i }));
    expect(screen.getByTestId('compose-replying-banner')).toHaveTextContent('Morning all');
    await type('Morning!');
    await waitFor((): void => { expect(sent()).toEqual([expect.objectContaining({ content: 'Morning!', reply_to: 'm1' })]); });
  });

  it('offers Edit and Delete on your own message only', async () => {
    await open();
    const menuOf = async (text: string): Promise<string[]> => {
      const row: HTMLElement = screen.getByText(text).closest('[data-message-id]') as HTMLElement;
      await userEvent.click(within(row).getByRole('button', { name: /message actions/i }));
      const items: string[] = (await screen.findAllByRole('menuitem')).map((el: HTMLElement): string => el.textContent ?? '');
      await userEvent.keyboard('{Escape}');
      return items;
    };
    expect((await menuOf('Hello Bob')).join(' ')).toMatch(/Edit.*Delete/);
    await waitFor((): void => { expect(screen.queryByRole('menu')).toBeNull(); });
    expect((await menuOf('Morning all')).join(' ')).not.toMatch(/Edit|Delete/);
  });

  it('shows a message the app wrote as a line, not a bubble', async () => {
    channelServer.reset(CHANNEL, 'ada', [
      channelMessage('m1', 'bob', 'Morning all', 1_700_000_000_000, {}),
      channelMessage('s1', 'system', 'Bob joined the room', 1_700_000_002_000, { message_type: 'System' }),
    ]);
    await open();
    expect(screen.getByText('Bob joined the room')).toHaveAttribute('role', 'status');
  });

  it('asks for older history when the reader scrolls to the top', async () => {
    const many: GroupMessage[] = Array.from({ length: 60 }, (_: unknown, i: number) => channelMessage(`h${i}`, 'bob', `line ${i}`, 1_600_000_000_000 + i, {}));
    channelServer.reset(CHANNEL, 'ada', [...many, channelMessage('m1', 'bob', 'Morning all', 1_700_000_000_000, {})]);
    await open();
    expect(screen.queryByText('line 5')).toBeNull();
    const viewport: Element | null = screen.getByRole('log', { name: 'Conversation' }).closest('[data-radix-scroll-area-viewport]');
    if (viewport === null) throw new Error('the transcript is no longer in a scroll viewport');
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    await screen.findByText('line 5');
    expect(channelServer.requests.filter((r) => r.GetGroupMessages?.before_timestamp !== undefined)).toHaveLength(1);
  });

  it('keeps what you were writing when you leave and come back', async () => {
    const first: ReturnType<typeof render> = await open();
    fireEvent.change(screen.getByTestId('group-message-input'), { target: { value: 'half a thought' } });
    first.unmount();
    await open();
    await waitFor((): void => { expect(screen.getByTestId('group-message-input')).toHaveValue('half a thought'); });
  });

  it('follows a role change while it is open', async () => {
    const view: ReturnType<typeof render> = await open();
    expect(screen.getByTestId('group-message-input')).toBeInTheDocument();
    view.rerender(chat('denied-by-role'));
    expect(screen.queryByTestId('group-message-input')).toBeNull();
    expect(screen.getByTestId('group-send-restricted')).toBeInTheDocument();
  });
});
