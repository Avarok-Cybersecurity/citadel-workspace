/**
 * Sending in a node channel while an update to its transcript is still waiting to render.
 *
 * The update can be anything React gives a lower priority than the Send press: a member's read
 * cursor (a receipt), a message pushed by the server. Until it renders, React re-applies every
 * later transcript update on top of the older state at each render, so the reader's own message
 * produced a NEW array on every render with the same messages in it. The scroll-follow hook keyed
 * its layout effect on that array and answered every run with a state update, which could not be
 * bailed out while the older update was pending; that forced another render, which re-applied the
 * send again: "Maximum update depth exceeded" in <ChatPane>, seen on a phone in CI.
 *
 * MOCKS, and why: only the socket. `@/lib/workspace-service` is the channel-server double, which
 * runs the real messaging operations and response handler; the pane, its hooks, the node
 * transport and the message manager are production code. The cursor move is handed to the real
 * response handler inside `startTransition`: in a browser a socket frame gets a lower priority
 * than a press by itself, but jsdom leaves `window.event` set to the last dispatched event, so a
 * plain call would be treated as part of that event and render at once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { startTransition } from 'react';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { handleGroupVariants } from '@/lib/workspace-response-handler/group-handlers';
import { channelServer, channelMessage } from '@/lib/chat/transport/__tests__/doubles/channel-server';
import type { ChatSelf } from '@/lib/chat/transport/chat-transport';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

vi.mock('@/lib/workspace-service', async () => ({
  default: (await import('@/lib/chat/transport/__tests__/doubles/channel-server')).channelServer.service,
}));

const { NodeChat } = await import('../NodeChat');

const CHANNEL: string = 'c0ffee00-0000-4000-8000-000000000002';
const SELF: ChatSelf = { cid: 7n, username: 'ada', displayName: 'Ada Lovelace' };
const CONNECTION: Parameters<typeof handleGroupVariants>[1] = { cid: 1, request_id: 'pending-update' };
type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };

const settle = (ms: number): Promise<void> => new Promise((resolve: () => void): void => { setTimeout(resolve, ms); });

/** Bob reads up to the reader's own message, as the kernel announces it, at a lower priority than a press. */
function bobReadsLater(): void {
  const moved: WorkspaceProtocolResponse = { GroupReadCursorMoved: { group_id: CHANNEL, cursor: { member: 'bob', upto_message_id: 'm2' } } };
  startTransition((): void => { handleGroupVariants(moved, CONNECTION); });
}

let errors: unknown[] = [];
const recordError = (event: ErrorEvent): void => { errors.push(event.error ?? event.message); };

beforeEach((): void => {
  HTMLElement.prototype.scrollTo = function scrollTo(): void {};
  groupMessagingManager.clearAll();
  channelServer.reset(CHANNEL, 'ada', []);
  channelServer.reset(CHANNEL, 'ada', [
    channelMessage('m1', 'bob', 'Morning all', 1_700_000_000_000, {}),
    channelMessage('m2', 'ada', 'Hello Bob', 1_700_000_001_000, {}),
  ]);
  // The server's copy is not back yet when the loop would start, as on a real round trip.
  channelServer.nextSend = { kind: 'hold' };
  errors = [];
  window.addEventListener('error', recordError);
});

afterEach((): void => {
  window.removeEventListener('error', recordError);
  (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
  cleanup();
  clearAllDraftsForTests();
});

describe('a send while a transcript update waits to render', () => {
  it('shows the sent message instead of re-rendering until React gives up', async () => {
    render(
      <ConfirmDialogProvider>
        <NodeChat nodeId="node-design" channelId={CHANNEL} channelName="Design" self={SELF} sendRestriction="allowed" rules={null} members={null} managesSubscription={false} />
      </ConfirmDialogProvider>,
    );
    await screen.findByText('Morning all');
    await settle(700); // past the pane's cached-history refresh, so nothing of the mount is still pending

    // Outside act(): act() renders every priority together, which is exactly what hides this.
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;
    fireEvent.change(screen.getByTestId('group-message-input'), { target: { value: 'On my way' } });
    await settle(50);
    bobReadsLater();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await settle(200);

    expect(errors.map(String)).toEqual([]);
    await waitFor((): void => { expect(screen.getByText('On my way')).toBeInTheDocument(); });
    expect(screen.getByText('Hello Bob')).toBeInTheDocument();
  });
});
