/**
 * The group's member list names people as the sidebar does: the roster's full
 * name, never the stored login name when a better one is known, never a CID.
 *
 * Live: the owner appeared as "alice0924" beside a sidebar reading "Alice
 * Anders", and a member as "16578695292150393372".
 *
 * Mocked: the registration roster's cache (agent I/O) and the tab identity
 * reads (IndexedDB).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { recordMemberNames } from '@/lib/member-names';
import type { GroupMemberWithRole } from '@/types/group';
import type { GroupRole } from '@/types/group-permissions';

const BOB: bigint = 16578695292150393372n;
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: {
    getPeers: (): { registeredPeers: { cid: bigint; username: string }[]; allPeers: unknown[] } => ({
      registeredPeers: [{ cid: 16578695292150393372n, username: 'bob0924' }],
      allPeers: [],
    }),
  },
}));
vi.mock('@/lib/tab-context', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  getSelectedUser: async (): Promise<null> => null,
}));
vi.mock('@/lib/connection', () => ({ connectionManager: { getTabSelectedSession: async (): Promise<null> => null, getConnectionInfo: (): null => null } }));

import { GroupMemberIdentity } from '../GroupMemberIdentity';

recordMemberNames([{ id: 'alice0924', displayName: 'Alice Anders' }, { id: 'bob0924', displayName: 'Bob Brown' }]);
const ROLE: GroupRole = { id: 'r', name: 'Member', position: 1, permissions: {} } as unknown as GroupRole;

function member(cid: bigint, username: string): GroupMemberWithRole {
  return { cid, username, roleId: 'r', joinedAt: 0, role: ROLE };
}

describe('a group member', () => {
  it('is the roster name, not the stored login name', () => {
    render(<GroupMemberIdentity member={member(555n, 'alice0924')} isOwner />);
    expect(screen.getByTestId('group-member-name-555')).toHaveTextContent('Alice Anders');
  });

  it('whose record stored their CID is named from the roster by CID', () => {
    render(<GroupMemberIdentity member={member(BOB, BOB.toString())} isOwner={false} />);
    expect(screen.getByTestId(`group-member-name-${BOB}`)).toHaveTextContent('Bob Brown');
  });

  it('the roster does not know is a handle, never a CID', () => {
    render(<GroupMemberIdentity member={member(4242424242424242n, '4242424242424242')} isOwner={false} />);
    const shown: string = screen.getByTestId('group-member-name-4242424242424242').textContent ?? '';
    expect(shown).toMatch(/^Peer /);
    expect(shown).not.toContain('4242424242424242');
  });
});
