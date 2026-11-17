/**
 * A document made in a chat is a Citadel Docs document: it opens in the canvas the moment its
 * invitation is in the conversation, whatever the network is doing with the invitation, and
 * the other person opens the same document from the invitation, kept in step peer to peer.
 *
 * Owner report (live site): after choosing the app in the chat's New document dialog the
 * document did not open; the conversation stayed on screen. The tab opened only once
 * `sendMessage` had resolved -- the whole round trip of the invitation (CheckState, the
 * leader's ack, the agent's transmit) -- and never if it failed, although the document
 * already existed. A text message stops waiting the moment its bubble exists
 * (`onOptimisticAppend`); the invitation does the same, and a later delivery failure belongs
 * to the bubble and a toast, not to the document.
 *
 * Rendered: the whole P2PChat, unmodified, with real replicas on the vendored wasm. Faked:
 * the network, the agent's LocalDB and the conversation store (doubles/chat-document-world.tsx),
 * and the cdoc runtime's worker, run in process because jsdom has no Worker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import { statedViewport } from '@/components/documents/__tests__/editor-harness';
import { ALICE, BOB, ChatDocumentWorld, chatOf, renderChats } from './doubles/chat-document-world';
import { canvasOpen, chatPane, FLOW_MS, makeDocument, storedText } from './doubles/chat-document-steps';

vi.mock('@/lib/cdoc/runtime-loader', async () => {
  const { inProcessRuntime } = await import('@/lib/cdoc/__tests__/wasm-rig');
  return { loadCdocRuntime: (): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread')) };
});

statedViewport();

let world: ChatDocumentWorld;
beforeEach(() => {
  world = new ChatDocumentWorld();
  world.install();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a document made in a chat', () => {
  it('opens in the canvas once its invitation is in the conversation, without waiting for the network', async () => {
    const user: UserEvent = userEvent.setup();
    renderChats(chatOf(ALICE, BOB));
    await makeDocument(user, 'Launch plan', '');

    await canvasOpen(chatPane('Alice'), 'Launch plan');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(chatPane('Alice')).queryByTestId('p2p-message-input')).toBeNull(); // the conversation is no longer the pane
    expect(world.invitations).toHaveLength(1);
    expect(world.invitations[0].options).toMatchObject({ messageType: 'live_document', documentTitle: 'Launch plan' });
    expect(world.invitations[0].options.documentId).toMatch(/^cdoc-[0-9a-f-]{36}$/);
  });

  it('stays open when the invitation then fails to deliver, and says the peer was not reached', async () => {
    world.delivery = 'fails';
    const user: UserEvent = userEvent.setup();
    renderChats(chatOf(ALICE, BOB));
    await makeDocument(user, 'Launch plan', '');

    await canvasOpen(chatPane('Alice'), 'Launch plan');
    expect(await screen.findByText(/did not acknowledge/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog and its error when nothing could be recorded', async () => {
    // The discrimination: the dialog's own failure path still renders, and no tab opens.
    world.delivery = 'fails-before-recording';
    const user: UserEvent = userEvent.setup();
    renderChats(chatOf(ALICE, BOB));
    await makeDocument(user, 'Launch plan', '');

    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not create the document/);
    expect(screen.queryByTestId('chat-document-pane')).toBeNull();
  });

  it('is written on this device under the account, its first paragraphs what was typed in the composer', async () => {
    const user: UserEvent = userEvent.setup();
    renderChats(chatOf(ALICE, BOB));
    await makeDocument(user, 'Notes', 'Agenda first{Shift>}{Enter}{/Shift}then the rest');
    await canvasOpen(chatPane('Alice'), 'Notes');
    const docId: string = world.invitations[0].options.documentId ?? '';

    const text: string = await storedText(world, chatPane('Alice'), ALICE, docId);
    expect(text).toContain('Agenda first');
    expect(text).toContain('then the rest');
    expect(world.db.keys(0n)).toEqual([]); // never the device-wide cid 0
  }, FLOW_MS);
});

describe('the other person', () => {
  it('opens the invitation into the same document, kept in step, and hears a rename', async () => {
    const user: UserEvent = userEvent.setup();
    renderChats(chatOf(ALICE, BOB));
    await makeDocument(user, 'Trip', 'Pack the tent');
    await canvasOpen(chatPane('Alice'), 'Trip');
    const docId: string = world.invitations[0].options.documentId ?? '';
    world.received(ALICE, world.invitationAsReceived(0));
    renderChats(chatOf(BOB, ALICE));

    await user.click(await within(chatPane('Bob')).findByRole('button', { name: /Trip/ }));
    await canvasOpen(chatPane('Bob'), 'Trip');
    await waitFor(() => expect(world.carried).toContain('diff'), { timeout: 5_000 });

    await user.click(within(chatPane('Alice')).getByTestId('live-doc-rename'));
    const input: HTMLElement = await screen.findByTestId('rename-document-input');
    await user.clear(input);
    await user.type(input, 'Trip to the lakes');
    await user.click(screen.getByTestId('rename-document-confirm'));
    await waitFor(() => expect(within(chatPane('Bob')).getByRole('heading', { level: 1 })).toHaveTextContent('Trip to the lakes'), { timeout: 5_000 });
    expect(within(chatPane('Bob')).getByRole('button', { name: 'Trip to the lakes' })).toBeTruthy();
    expect(within(chatPane('Alice')).getByRole('button', { name: 'Trip to the lakes' })).toBeTruthy();

    expect(await storedText(world, chatPane('Bob'), BOB, docId)).toContain('Pack the tent');
  }, FLOW_MS);
});
