/**
 * Pressing your own name in a members list opens your scratchpad: the conversation addressed by
 * your own cid, which the workspace view renders as the scratchpad (lib/scratchpad).
 *
 * Real: the opener and member-chat-target. Stood in, with the reason: the navigation (a router
 * and the unsaved-edit guard; what it is asked to open is the evidence) and the tab's identity
 * (read from IndexedDB, which jsdom has not got).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { WorkspaceMember } from '@/types/workspace-entities';

const opened: Array<[string, string]> = [];
const tab: { cid: bigint | undefined } = { cid: 77n };
vi.mock('../use-open-conversation', () => ({ useOpenConversation: (): ((cid: string, username: string) => Promise<void>) => async (cid: string, username: string): Promise<void> => { opened.push([cid, username]); } }));
vi.mock('@/hooks/use-tab-identity', () => ({ useTabIdentity: (): { cid: bigint; username: string } | null => (tab.cid === undefined ? null : { cid: tab.cid, username: 'me' }) }));

const { useMemberChatOpener } = await import('../use-member-chat-opener');

const member = (username: string): WorkspaceMember => ({ id: username, username, displayName: username }) as unknown as WorkspaceMember;
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { opened.length = 0; tab.cid = 77n; });

describe('your own row in the members list', () => {
  it('opens the conversation with your own cid', async () => {
    const { result } = renderHook(() => useMemberChatOpener('me', []));
    const open: (() => void) | null = result.current(member('me'));
    expect(open).not.toBeNull();
    open?.();
    await settle();
    expect(opened).toEqual([['77', 'me']]);
  });

  it('opens a contact\'s chat at their cid, not yours', async () => {
    const { result } = renderHook(() => useMemberChatOpener('me', [{ cid: 12n, username: 'bob' } as never]));
    result.current(member('bob'))?.();
    await settle();
    expect(opened).toEqual([['12', 'bob']]);
  });
});
