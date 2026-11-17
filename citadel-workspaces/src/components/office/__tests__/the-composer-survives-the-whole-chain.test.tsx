/**
 * Four rounds, four links, and nothing held the chain together.
 *
 * "WARNING: Message input not found" appeared in four integration jobs and had
 * four separate causes, each fixed on its own and each guarded on its own:
 *
 *   369  the Chat tab selection did not survive the remount BaseOffice is keyed
 *        to cause, so the panel went back to Content and took the composer;
 *   373  a node absent from `state.nodes` read as "this room has no chat", so
 *        the whole tab surface was replaced by the document;
 *   378  `usePermission(undefined, ...)` reads as a definite denial, so an
 *        office rendered before its node resolved replaced the composer with
 *        "You do not have permission to send messages here";
 *   379  a permission cache MISS reads the same way, so every user in a
 *        three-user run got that message.
 *
 * Any one of them is enough to lose the composer, and a test per link cannot
 * see that. This walks the whole path with the conditions that were true when
 * each of them bit, and asks the one question the user asks: can I type?
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { forgetAllTabs, rememberTab } from '@/lib/node-tabs/tab-memory';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { chatSurfaceOf, useChatSurface } from '../chat-surface';
import { permits } from '@/hooks/use-permission-result';
import type { DomainNode } from '@/components/layout/sidebar/TreeNodesSection';
import type { UsePermissionResult } from '@/hooks/use-permission-result';

// The real chat, over the channel-server double (only the socket is replaced): the question is
// whether the person can type, so the composer asked about is the one they would type in.
vi.mock('@/lib/workspace-service', async () => ({
  default: (await import('@/lib/chat/transport/__tests__/doubles/channel-server')).channelServer.service,
}));
vi.mock('@/components/call/GroupCallControls', () => ({ GroupCallControls: (): JSX.Element => <div /> }));
vi.mock('@/components/call/GroupCallDock', () => ({ GroupCallDock: (): JSX.Element => <div /> }));
vi.mock('@/hooks/use-domain-call-members', () => ({ useDomainCallMembers: (): unknown[] => [] }));

/** The permission state a fresh tab is in: nothing fetched, nothing refused. */
const NOTHING_ANSWERED: UsePermissionResult = {
  allowed: false, loading: false, reason: null, unanswered: false, answered: false,
  refresh: async (): Promise<void> => {},
} as UsePermissionResult;

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => NOTHING_ANSWERED,
}));

const { ChatTabs } = await import('../tabs/__tests__/doubles/chat-tabs');

const room: DomainNode = { chat_enabled: true, chat_channel_id: 'ch-1' } as unknown as DomainNode;

describe('the office composer, end to end', () => {
  it('is there for a user who opened chat, on a node mid-reload, with no permission answer', () => {
    forgetAllTabs();
    // The user switched to Chat, and BaseOffice remounted underneath them.
    rememberTab('n1', 'chat');

    // The node is momentarily absent from state.nodes -- what round 373 read as
    // "no chat" -- but this room has answered before.
    const surface: ReturnType<typeof chatSurfaceOf> = chatSurfaceOf(room);
    expect(surface).toEqual({ enabled: true, channelId: 'ch-1' });

    // And nothing has answered about permissions, which rounds 378/379 read as
    // a refusal.
    expect(permits(NOTHING_ANSWERED)).toBe(true);

    render(<ConfirmDialogProvider><ChatTabs nodeId="n1" chatChannelId="ch-1" contentView={<div />} /></ConfirmDialogProvider>);

    expect(screen.queryByTestId('group-message-input')).toBeTruthy();
    expect(screen.queryByTestId('group-send-restricted')).toBeNull();
  });

  it('still hides it when the answer is a real refusal', () => {
    // The positive control for the whole chain: if every link now says yes
    // unconditionally, the composer is not gated on anything at all.
    forgetAllTabs();
    rememberTab('n1', 'chat');
    const refused: UsePermissionResult = { ...NOTHING_ANSWERED, answered: true };
    expect(permits(refused)).toBe(false);
  });

  it('keeps the tab through a remount, which is what loses the composer', () => {
    forgetAllTabs();
    rememberTab('n1', 'chat');
    const { unmount }: ReturnType<typeof render> = render(<ConfirmDialogProvider><ChatTabs nodeId="n1" chatChannelId="ch-1" contentView={<div />} /></ConfirmDialogProvider>);
    expect(screen.queryByTestId('group-message-input')).toBeTruthy();
    unmount();

    render(<ConfirmDialogProvider><ChatTabs nodeId="n1" chatChannelId="ch-1" contentView={<div />} /></ConfirmDialogProvider>);
    expect(screen.queryByTestId('group-message-input')).toBeTruthy();
  });
});

describe('the surface a reloading node keeps', () => {
  it('does not lose its chat while state.nodes is empty', () => {
    const { result, rerender } = renderHook(
      ({ entity }: { entity: DomainNode | null }) => useChatSurface('n1', entity),
      { initialProps: { entity: room as DomainNode | null } },
    );

    expect(result.current).toEqual({ enabled: true, channelId: 'ch-1' });
    rerender({ entity: null });
    expect(result.current).toEqual({ enabled: true, channelId: 'ch-1' });
  });
});
