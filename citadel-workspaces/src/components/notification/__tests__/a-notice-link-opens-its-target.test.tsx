/**
 * A native notice's link opens the workspace at its conversation, call or the
 * requests list, once the workspace is up; once, and only that kind.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({
  p2pMessengerManager: { getConversation: (peer: bigint): { peerUsername: string } | undefined => (peer === 9n ? { peerUsername: 'bob' } : undefined) },
}));

import { useLinkTargetOpener } from '../use-link-target';
import { stashLinkTarget } from '@/lib/onboarding/link-target';
import { eventEmitter } from '@/lib/event-emitter';

function Opener({ onRequests }: { onRequests: () => void }): null {
  useLinkTargetOpener(onRequests);
  return null;
}

describe('opening what a notice was about', () => {
  it('opens the conversation of a message or call, by name when known', () => {
    const opened: unknown[] = [];
    const off: () => void = eventEmitter.on('p2p:open-conversation', (p: unknown) => { opened.push(p); });
    stashLinkTarget({ kind: 'call', peerCid: 9n });
    const requests = vi.fn<() => void>();
    render(<Opener onRequests={requests} />);
    expect(opened).toEqual([{ peerCid: 9n, peerUsername: 'bob' }]);
    expect(requests).not.toHaveBeenCalled();
    render(<Opener onRequests={requests} />);
    expect(opened).toHaveLength(1);
    off();
  });

  it('opens the requests list for a request', () => {
    stashLinkTarget({ kind: 'requests' });
    const requests = vi.fn<() => void>();
    render(<Opener onRequests={requests} />);
    expect(requests).toHaveBeenCalledTimes(1);
  });

  it('leaves a settings target for the settings', () => {
    stashLinkTarget({ kind: 'settings' });
    const requests = vi.fn<() => void>();
    render(<Opener onRequests={requests} />);
    expect(requests).not.toHaveBeenCalled();
  });
});
