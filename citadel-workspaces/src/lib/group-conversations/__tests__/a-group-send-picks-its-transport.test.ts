/**
 * Which wire a group message goes out on.
 *
 * A node-backed chat channel belongs to the workspace server, which authorises
 * it by resolving the channel to the node that owns it. A peer group is keyed
 * `<cid>:<mgid>`, is owned by no node, and the same server refuses it —
 * correctly, since the channel is not its:
 *
 *   Permission denied: not a member of this chat channel
 *
 * `useGroupChat` sent both through the workspace protocol, so peer-group chat
 * failed in both directions while creating, inviting, leaving, kicking and
 * listing all worked. This is the choice that was missing.
 */
import { describe, it, expect } from 'vitest';
import { groupSendTransport } from '../group-send-transport';

describe('choosing the transport for a group message', () => {
  it('sends a peer group over the peer wire', () => {
    expect(groupSendTransport('7:42')).toBe('peer');
  });

  it('sends a node-backed chat channel over the workspace protocol', () => {
    // Chat channel ids are minted per node and are not group keys.
    expect(groupSendTransport('9f3c1e2a-0000-4000-8000-000000000001')).toBe('workspace');
  });

  it('treats anything unparseable as the workspace channel it looks like', () => {
    // The peer wire would reject it outright; the workspace server answers with
    // a message naming the channel, which is the more useful failure.
    expect(groupSendTransport('')).toBe('workspace');
    expect(groupSendTransport('7:')).toBe('workspace');
    expect(groupSendTransport('not:a:key')).toBe('workspace');
  });
});
