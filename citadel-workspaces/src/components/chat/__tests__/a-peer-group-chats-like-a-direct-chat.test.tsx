/**
 * A peer group is the direct chat's pane, over the peer wire.
 *
 * GroupChatView gave a peer group its own box and its own rules (`canRevise`, `canReact`,
 * `sharesFiles`, `canPageOlder`, decided from the id). It now renders the same pane as a direct
 * chat and a node channel, and what it offers is what its transport carries: messages, replies,
 * reactions and files, and no edit, delete or markdown, which the peer wire has no form for.
 *
 * MOCKS, and why: the wire (`group-requests`, captured instead of sent), the file fan-out
 * (`send-group-file` offers the file to each member over the agent's socket), the file-transfer
 * service (its singleton opens IndexedDB and the socket on import), storage (a Map; jsdom has no
 * IndexedDB) and the signed-in account. The pane, the transport, the message manager, delivery,
 * reactions and the transcript store run for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { decodeGroupReaction, type PeerGroupReaction } from '@/lib/group-conversations/group-reaction-codec';

const world: { sent: Uint8Array[]; texts: string[]; shared: File[]; store: Map<string, unknown> } = vi.hoisted(() => ({
  sent: [], texts: [], shared: [], store: new Map<string, unknown>(),
}));
vi.mock('@/lib/storage-utils', () => ({
  dbGet: async (_s: string, k: string): Promise<unknown> => (world.store.has(k) ? structuredClone(world.store.get(k)) : undefined),
  dbPut: async (_s: string, k: string, v: unknown): Promise<void> => { world.store.set(k, structuredClone(v)); },
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: 99n }) };
});
vi.mock('@/lib/workspace-service', () => ({ default: {} }));
vi.mock('@/lib/group-conversations/group-requests', () => ({
  sendPeerGroupMessage: async (_g: string, content: string): Promise<string> => { world.texts.push(content); return `minted-${world.texts.length}`; },
  sendPeerGroupBody: async (_g: string, encode: (cid: bigint, id: string) => Uint8Array): Promise<string> => {
    world.sent.push(encode(99n, 'envelope-1'));
    return 'envelope-1';
  },
}));
vi.mock('@/lib/group-conversations/send-group-file', () => ({
  sendGroupFile: async (_g: string, file: File): Promise<void> => { world.shared.push(file); },
}));
vi.mock('@/lib/file-transfer', () => ({
  fileTransferService: { acceptTransfer: vi.fn(), declineTransfer: vi.fn(), cancelTransfer: vi.fn(), getTransfer: (): undefined => undefined, isOfferArriving: (): boolean => false },
  FILE_TRANSFER_EVENTS: { STATE_CHANGED: 'file-transfer:state-changed', COMPLETED: 'file-transfer:completed' },
}));

const { PeerGroupChat } = await import('../PeerGroupChat');
const { deliverPeerGroupMessage } = await import('@/lib/group-conversations/peer-group-delivery');
const { groupMessagingManager } = await import('@/lib/group-messaging-manager');

const GROUP: string = '7:42';
const FILE: File = new File(['hello'], 'plan.txt', { type: 'text/plain' });

async function open(): Promise<void> {
  render(
    <ConfirmDialogProvider>
      <PeerGroupChat groupId={GROUP} groupName="Friends" readerId="99" readerName="Ada" readerCid={99n} sendRestriction="allowed" />
    </ConfirmDialogProvider>,
  );
  await screen.findByText(/Start the conversation in Friends/);
  act((): void => {
    deliverPeerGroupMessage({ groupId: GROUP, messageId: 'm1', senderId: '7', senderName: 'bob', content: 'Who is in?', timestamp: 1_700_000_000_000 });
  });
  await screen.findByText('Who is in?');
}

beforeEach((): void => {
  HTMLElement.prototype.scrollTo = function scrollTo(): void {}; // jsdom has no layout
  groupMessagingManager.clearAll();
  world.sent.length = 0; world.texts.length = 0; world.shared.length = 0; world.store.clear();
});
afterEach((): void => { cleanup(); clearAllDraftsForTests(); });

describe('a peer group', () => {
  it('puts your own message on your screen once, as yours', async () => {
    await open();
    fireEvent.change(screen.getByTestId('group-message-input'), { target: { value: 'Me!' } });
    await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })); });
    await waitFor((): void => { expect(screen.getAllByText('Me!')).toHaveLength(1); });
    expect(world.texts).toEqual(['Me!']);
    // Another member's message names them; yours does not.
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.queryByText('Ada')).toBeNull();
  });

  it('shows your reaction and sends the members a reaction, never a chat body', async () => {
    await open();
    const row: HTMLElement = screen.getByText('Who is in?').closest('[data-message-id]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /message actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'React with 👍' }));
    await screen.findByTestId('reaction-chip');
    const envelope: PeerGroupReaction | null = decodeGroupReaction(world.sent[0]);
    expect(envelope?.reaction).toMatchObject({ target_id: 'm1', emoji: '👍', active: true });
  });

  it('offers no edit, no delete and no markdown, which the peer wire cannot carry', async () => {
    await open();
    fireEvent.change(screen.getByTestId('group-message-input'), { target: { value: 'Mine' } });
    await act(async (): Promise<void> => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })); });
    const row: HTMLElement = (await screen.findByText('Mine')).closest('[data-message-id]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /message actions/i }));
    const items: string = (await screen.findAllByRole('menuitem')).map((el: HTMLElement): string => el.textContent ?? '').join(' ');
    expect(items).toMatch(/Reply/);
    expect(items).not.toMatch(/Edit|Delete/);
    expect(screen.queryByTestId('message-type-markdown')).toBeNull();
  });

  it('shares a picked file and a dropped file with every member', async () => {
    await open();
    const picker: HTMLInputElement = screen.getByTestId('group-file-input') as HTMLInputElement;
    const opened = vi.spyOn(picker, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Send file' }));
    expect(opened).toHaveBeenCalledTimes(1);
    fireEvent.change(picker, { target: { files: [FILE] } });
    await waitFor((): void => { expect(world.shared).toEqual([FILE]); });

    const chat: HTMLElement = screen.getByTestId('group-chat');
    const drag: { dataTransfer: { types: string[]; files: File[] } } = { dataTransfer: { types: ['Files'], files: [FILE] } };
    fireEvent.dragEnter(chat, drag);
    expect(screen.getByTestId('chat-drop-overlay')).toHaveTextContent('Drop a file to send it to Friends');
    fireEvent.drop(chat, drag);
    await waitFor((): void => { expect(world.shared).toEqual([FILE, FILE]); });
  });
});
