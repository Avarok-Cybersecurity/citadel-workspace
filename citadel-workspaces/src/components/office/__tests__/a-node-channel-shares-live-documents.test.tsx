/**
 * A node channel shares live documents as a direct chat does: the same composer control and
 * dialog, the same card in the transcript, the same document tab. What differs is said, not
 * hidden: the message names the document by its id for every reader to open, and the strip over
 * it says the channel's readers share it and the server keeps it. No rename is offered, because
 * nothing carries one for a channel's document yet.
 *
 * MOCKS, and why: the socket (`@/lib/workspace-service` is the channel-server double, as in the
 * other node channel tests), and the cdoc runtime, which needs a worker jsdom does not have; the
 * document's own sync is covered by lib/cdoc/collab's tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { channelServer, channelMessage } from '@/lib/chat/transport/__tests__/doubles/channel-server';
import type { ChatSelf } from '@/lib/chat/transport/chat-transport';
import type { GroupMessage } from '@/types/workspace-entities';

vi.mock('@/lib/workspace-service', async () => ({
  default: (await import('@/lib/chat/transport/__tests__/doubles/channel-server')).channelServer.service,
}));
// The canvas stays loading: what is under test is the channel around it.
vi.mock('@/lib/cdoc/runtime-loader', () => ({ loadCdocRuntime: (): Promise<never> => new Promise<never>((): void => undefined) }));

const { NodeChat } = await import('../NodeChat');

const CHANNEL: string = 'c0ffee00-0000-4000-8000-000000000003';
const SELF: ChatSelf = { cid: 7n, username: 'ada', displayName: 'Ada Lovelace' };
const DOC: string = 'cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b';
const SHARED_WITH: string = 'On the workspace server, shared live with everyone in Design';

async function open(): Promise<void> {
  render(
    <ConfirmDialogProvider>
      <NodeChat nodeId="node-design" channelId={CHANNEL} channelName="Design" self={SELF} sendRestriction="allowed" rules={null} members={null} managesSubscription={false} />
    </ConfirmDialogProvider>,
  );
  await screen.findByText('Morning all');
}

const shares = (): unknown[] => channelServer.requests.filter((r) => r.SendGroupMessage !== undefined).map((r) => r.SendGroupMessage);

beforeEach((): void => {
  HTMLElement.prototype.scrollTo = function scrollTo(): void {};
  groupMessagingManager.clearAll();
  channelServer.reset(CHANNEL, 'ada', []);
  channelServer.reset(CHANNEL, 'ada', [channelMessage('m1', 'bob', 'Morning all', 1_700_000_000_000, {})]);
});
afterEach((): void => { cleanup(); clearAllDraftsForTests(); });

describe('a node channel\'s live documents', () => {
  it('are shared by a message naming the document, and open in a tab that says who shares it', async () => {
    const user: UserEvent = userEvent.setup();
    await open();
    await user.click(screen.getByTestId('message-type-live-doc'));
    const dialog: HTMLElement = await screen.findByRole('dialog');
    await user.click(within(dialog).getByTestId('live-doc-app-docs'));
    await user.type(within(dialog).getByTestId('live-doc-title'), 'Agenda');
    await user.click(within(dialog).getByTestId('live-doc-create'));

    const pane: HTMLElement = await screen.findByTestId('chat-document-pane');
    expect(pane).toHaveTextContent(SHARED_WITH);
    expect(within(pane).queryByTestId('live-doc-rename')).toBeNull();
    expect(shares()).toEqual([expect.objectContaining({ content: 'Agenda', message_type: { LiveDocument: { document_id: pane.dataset.documentId } } })]);
    expect(pane.dataset.documentId).toMatch(/^cdoc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('arrive as a card another member\'s share puts in the transcript, which opens the same document', async () => {
    const user: UserEvent = userEvent.setup();
    await open();
    const shared: GroupMessage = { ...channelMessage('m2', 'bob', 'Agenda', 1_700_000_002_000, {}), message_type: { LiveDocument: { document_id: DOC } } };
    channelServer.broadcast(shared);
    await user.click(await screen.findByRole('button', { name: /Agenda/ }));
    const pane: HTMLElement = await screen.findByTestId('chat-document-pane');
    await waitFor((): void => expect(pane.dataset.documentId).toBe(DOC));
    expect(pane).toHaveTextContent(SHARED_WITH);
  });
});
