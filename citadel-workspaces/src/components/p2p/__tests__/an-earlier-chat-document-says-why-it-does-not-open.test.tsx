/**
 * An invitation from before this release names a document made in the earlier chat editor.
 * Opening it moves it to Citadel Docs once on this device; when that cannot happen the tab
 * says why, in words, and offers the original read-only wherever this account may read it.
 * Never silent, never a blank document, and a failed read is never "there is no original".
 *
 * Rendered: the whole P2PChat, unmodified, the migration's production code behind it. Faked:
 * the network, the agent's LocalDB (failing a chosen read, as a timed-out request does) and the
 * conversation store (doubles/chat-document-world.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import { statedViewport } from '@/components/documents/__tests__/editor-harness';
import { ALICE, BOB, ChatDocumentWorld, chatOf, renderChats } from './doubles/chat-document-world';
import { chatPane } from './doubles/chat-document-steps';

vi.mock('@/lib/cdoc/runtime-loader', async () => {
  const { inProcessRuntime } = await import('@/lib/cdoc/__tests__/wasm-rig');
  return { loadCdocRuntime: (): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread')) };
});

statedViewport();

const DOC: string = '8b0c3a52-1f7e-4c55-9d1e-3f1c4a0e2b77';
const OUTSIDER: bigint = 10_000_000_000_000_000_303n;

let world: ChatDocumentWorld;
beforeEach(() => {
  world = new ChatDocumentWorld();
  world.install();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Alice opens Bob's earlier invitation, "Plan", and the tab says what happened. */
async function openBobsInvitation(user: UserEvent): Promise<HTMLElement> {
  world.received(BOB, world.earlierInvitation(BOB, ALICE, DOC, 'Plan'));
  renderChats(chatOf(ALICE, BOB));
  await user.click(await within(chatPane('Alice')).findByRole('button', { name: /Plan/ }));
  return within(chatPane('Alice')).findByTestId('chat-document-unmoved', {}, { timeout: 5_000 });
}

describe('an earlier chat document that cannot be opened here', () => {
  it('says it is not on this device when it was never opened here, and opens nothing in its place', async () => {
    const notice: HTMLElement = await openBobsInvitation(userEvent.setup());
    expect(within(notice).getByRole('alert')).toHaveTextContent('This document is not on this device');
    expect(notice).toHaveTextContent('“Plan” was made in the earlier chat editor and was never opened on this device');
    expect(notice).toHaveTextContent('Bob still has their copy.');
    expect(within(notice).queryByTestId('migration-show-original')).toBeNull();
    expect(screen.queryByTestId('chat-document-pane')).toBeNull();
  });

  it('refuses a copy that belongs to another account on this device, and offers none of it', async () => {
    await world.storeEarlierDocument(DOC, OUTSIDER, BOB, 'Plan', ['not Alice’s to read']);
    const before: readonly number[] | null = await world.stored(0n, `live_doc_${DOC}`);
    const notice: HTMLElement = await openBobsInvitation(userEvent.setup());
    expect(notice).toHaveTextContent('This document belongs to another account');
    expect(notice).not.toHaveTextContent('not Alice’s to read');
    expect(within(notice).queryByTestId('migration-show-original')).toBeNull();
    expect(await world.stored(0n, `live_doc_${DOC}`)).toEqual(before);
    expect(world.db.keys(ALICE)).toEqual([]);
  });

  it('says the original could not be read, never that there is none, and says so again when asked for it', async () => {
    await world.storeEarlierDocument(DOC, ALICE, BOB, 'Plan', ['Ship Friday']);
    world.failRead = (cid: bigint, key: string): Error | null => (cid === 0n && key === `live_doc_${DOC}` ? new Error('LocalDB request timed out after 5000ms') : null);
    const user: UserEvent = userEvent.setup();
    const notice: HTMLElement = await openBobsInvitation(user);
    expect(notice).toHaveAttribute('data-reason', 'failed');
    expect(notice).toHaveTextContent('could not be moved to the new editor: the original could not be read from this device (LocalDB request timed out after 5000ms)');
    expect(notice).toHaveTextContent('The original is kept, unchanged, and can be read here.');
    await user.click(within(notice).getByTestId('migration-show-original'));
    expect(await within(notice).findByTestId('migration-original-error')).toHaveTextContent('The original could not be opened. LocalDB request timed out after 5000ms');
    expect(world.db.keys(ALICE)).toEqual([]);
  });
});
