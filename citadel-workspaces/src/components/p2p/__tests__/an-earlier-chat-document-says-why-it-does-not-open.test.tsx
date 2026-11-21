/**
 * An invitation from an earlier version names a document made in the earlier chat editor. This
 * version does not open those: the tab says so, in words, and opens nothing in its place, never
 * a blank document that would pass for the one invited to.
 *
 * Rendered: the whole P2PChat, unmodified. Faked: the network, the agent's LocalDB and the
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

let world: ChatDocumentWorld;
beforeEach(() => {
  world = new ChatDocumentWorld();
  world.install();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('an earlier chat document', () => {
  it('says it cannot be opened, opens nothing in its place, and writes nothing', async () => {
    world.received(BOB, world.earlierInvitation(BOB, ALICE, DOC, 'Plan'));
    renderChats(chatOf(ALICE, BOB));
    const user: UserEvent = userEvent.setup();
    await user.click(await within(chatPane('Alice')).findByRole('button', { name: /Plan/ }));
    const notice: HTMLElement = await within(chatPane('Alice')).findByTestId('chat-document-unopened', {}, { timeout: 5_000 });
    expect(within(notice).getByRole('alert')).toHaveTextContent('This document cannot be opened');
    expect(notice).toHaveTextContent('“Plan” was made in the earlier chat editor, which this version of the app no longer opens.');
    expect(notice).toHaveAttribute('data-reason', 'earlier-editor');
    expect(screen.queryByTestId('chat-document-pane')).toBeNull();
    expect(world.db.keys(ALICE)).toEqual([]);
  });
});
