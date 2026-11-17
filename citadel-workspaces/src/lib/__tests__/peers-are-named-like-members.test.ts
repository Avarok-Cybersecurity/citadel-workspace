/**
 * A P2P surface that knows only a peer's username shows the name the member
 * list shows for them. The chat header and pending requests showed `bob0924`
 * for a peer the member list called "Bob Brown".
 *
 * Driven through the real response handler: a `Members` response is what
 * teaches the names, and nothing is mocked.
 */
import { describe, it, expect } from 'vitest';
import { handleGeneratedVariants } from '../workspace-response-handler/generated-variant-handlers';
import { peerDisplayName, peerInitials } from '../peer-display';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

function membersArrive(members: Array<{ id: string; name: string }>): void {
  const response: WorkspaceProtocolResponse = {
    Members: {
      domain_id: 'root',
      members: members.map((m) => ({ ...m, role: 'Member', permissions: {}, metadata: {} })),
    },
  } as unknown as WorkspaceProtocolResponse;
  handleGeneratedVariants(response, { cid: 0, request_id: 'r' });
}

describe('naming a peer known only by username', () => {
  it('uses the member list name once the roster has arrived', () => {
    membersArrive([{ id: 'bob0924', name: 'Bob Brown' }]);
    expect(peerDisplayName({ cid: 42n, username: 'bob0924' })).toBe('Bob Brown');
    expect(peerInitials({ cid: 42n, username: 'bob0924' })).toBe('B');
  });

  it('keeps a full name the caller already has', () => {
    membersArrive([{ id: 'bob0924', name: 'Bob Brown' }]);
    expect(peerDisplayName({ cid: 42n, username: 'bob0924', fullName: 'Robert' })).toBe('Robert');
  });

  it('falls back to the username for someone the roster does not name', () => {
    membersArrive([{ id: 'carol', name: 'carol' }]);
    expect(peerDisplayName({ cid: 43n, username: 'carol' })).toBe('carol');
    expect(peerDisplayName({ cid: 44n, username: 'dave' })).toBe('dave');
  });
});
