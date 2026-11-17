/**
 * The sidebar row for a pending invitation: who asked, for which group, and
 * the two answers. Accepting used to be the only outcome and nobody was asked.
 *
 * Mocked: the websocket (the I/O boundary; the assertion reads the request that
 * would leave the browser) and the connection lookup that request needs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const h: { sent: Array<Record<string, unknown>> } = vi.hoisted(() => ({ sent: [] }));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: { sendMessage: async (r: Record<string, unknown>): Promise<void> => { h.sent.push(r); } },
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getConnectionInfo: (): { cid: bigint; username: string } => ({ cid: 33n, username: 'bob' }),
    getTabSelectedSession: async (): Promise<null> => null,
  },
}));

import { GroupInviteList } from '../GroupInviteList';
import { addPendingInvite, getPendingInvites, removePendingInvite } from '@/lib/group-conversations/group-invites';
import { SidebarProvider } from '@/components/ui/sidebar';

const INVITE: { groupId: string; groupName: string; inviterId: string; inviterUsername: string } = {
  groupId: '11:77', groupName: '', inviterId: '11', inviterUsername: 'alice',
};

beforeEach(() => {
  h.sent.length = 0;
  removePendingInvite(INVITE.groupId);
});

const mount = (): void => { render(<SidebarProvider><GroupInviteList /></SidebarProvider>); };

describe('a pending invitation in the sidebar', () => {
  it('renders nothing when nobody has invited you', () => {
    mount();
    expect(screen.queryByTestId('group-invite-list')).toBeNull();
  });

  it('says who invited you to what, and offers both answers', () => {
    act(() => { addPendingInvite(INVITE); });
    mount();
    // The wire carries no group name; the row must not present a made-up one as real.
    expect(screen.getByTestId('group-invite-row').textContent).toContain('alice invited you to a group');
    expect(screen.getByTestId('group-invite-row').textContent).not.toContain("alice's Group");
    expect(screen.getByTestId('group-invite-accept')).toBeTruthy();
    expect(screen.getByTestId('group-invite-decline')).toBeTruthy();
  });

  it('names the group when the invitation carries its name', () => {
    act(() => { addPendingInvite({ ...INVITE, groupName: 'Design' }); });
    mount();
    expect(screen.getByTestId('group-invite-row').textContent).toContain('alice invited you to "Design"');
  });

  it('Decline tells the server no and removes the row', async () => {
    act(() => { addPendingInvite(INVITE); });
    mount();
    fireEvent.click(screen.getByTestId('group-invite-decline'));
    await waitFor(() => { expect(screen.queryByTestId('group-invite-row')).toBeNull(); });
    const respond: { response: boolean } | undefined = h.sent
      .map((r) => r.GroupRespondRequest as { response: boolean } | undefined)
      .find((r) => r !== undefined);
    expect(respond?.response).toBe(false);
    expect(getPendingInvites()).toEqual([]);
  });
});
