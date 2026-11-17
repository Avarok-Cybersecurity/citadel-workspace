/**
 * A refused peer registration request has to say so.
 *
 * The store clears the outgoing request when the refusal arrives, and the
 * request then vanishes from the list with nothing said. `usePeerDiscovery`
 * says something, but only while the discovery modal is open and only for
 * requests sent from it — and a refusal arrives when the other person answers,
 * which is usually long after that modal has closed.
 *
 * Written in the same change as the emit: an event with no listener is the
 * shape that left `revfs:persist-failed` unheard for months.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { PeerRefusalNotice } from '../PeerRefusalNotice';
import { eventEmitter } from '@/lib/event-emitter';

const toast: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: ReturnType<typeof vi.fn> } => ({ toast }),
}));

afterEach((): void => { cleanup(); toast.mockClear(); });

describe('a refused request', () => {
  it('names the peer who refused it', () => {
    render(<PeerRefusalNotice />);

    act((): void => {
      eventEmitter.emit('peer-registration:refused', {
        requestId: 'req-7', reason: 'peer declined', peerUsername: 'bob',
      });
    });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      variant: 'destructive',
      title: 'bob did not accept your request',
    });
  });

  it('says nothing for a refusal this tab has no request for', () => {
    // The store returns the record it removed; nothing removed means the
    // refusal belongs to another session, or arrived twice. Naming a peer we
    // cannot name would produce "undefined did not accept your request".
    render(<PeerRefusalNotice />);

    act((): void => {
      eventEmitter.emit('peer-registration:refused', { requestId: 'req-7', reason: 'gone' });
    });

    expect(toast).not.toHaveBeenCalled();
  });
});
