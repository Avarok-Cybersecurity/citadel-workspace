import { describe, it, expect } from 'vitest';
import { resolveP2PChannel } from '../use-p2p-channel-param';
import type { RegisteredPeer } from '@/hooks/use-registered-peers';

const bob: RegisteredPeer = { cid: '165', username: 'bob0924', displayName: 'Bob Brown', isOnline: true, isConnected: true, connectionPath: null };

describe('resolveP2PChannel', () => {
  it('uses channel when the link has it', () => {
    expect(resolveP2PChannel('9', 'bob0924', [bob])).toBe('9');
  });
  it('finds the peer by username when the link names only the peer', () => {
    expect(resolveP2PChannel(null, 'bob0924', [bob])).toBe('165');
  });
  it('opens nothing for an unknown name or no name', () => {
    expect(resolveP2PChannel(null, 'nobody', [bob])).toBeNull();
    expect(resolveP2PChannel(null, null, [bob])).toBeNull();
  });
});
