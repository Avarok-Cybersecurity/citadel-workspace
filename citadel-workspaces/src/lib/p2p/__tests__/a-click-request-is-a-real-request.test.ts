/**
 * A click on someone in the Messages page's Available list sends the same
 * request the discovery modal and the directory send.
 *
 * It built its own PeerRegister, and the copy differed from the one every other
 * entry point uses in three ways, each a defect:
 *
 *  - It recorded nothing. The poll never resent it, the outgoing list never
 *    showed it, and when the peer answered, `weAskedThemFirst` was false -- so
 *    with strangers refused, the answer to OUR request was declined as a
 *    stranger's.
 *  - It announced `p2p:peer-registered` the moment the frame left. Registered
 *    means mutual (`list_registered` answers from `GetMutuals`); the messenger
 *    flushed messages held for that peer and auto-connect dialled them before
 *    they had agreed to anything.
 *  - Its CIDs were strings. The client coerced them back on the wire, but
 *    CLAUDE.md forbids string CIDs at every boundary.
 *
 * Real: the registration store, the SSOT sender, the event bus. Faked:
 * `websocketService`, the process boundary to the local agent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: { sent: Array<Record<string, unknown>> } = vi.hoisted((): { sent: Array<Record<string, unknown>> } => ({ sent: [] }));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: vi.fn((m: Record<string, unknown>): Promise<void> => { h.sent.push(m); return Promise.resolve(); }),
    sendLocalDBGet: vi.fn((): Promise<never> => Promise.reject(new Error('Key not found'))),
    sendLocalDBSet: vi.fn((): Promise<void> => Promise.resolve()),
  },
}));

import '@/lib/peer-registration-store';
import { autoRegisterPeer } from '../messenger-compatibility';
import { peerRegistrationStore } from '@/lib/peer-registration-store';
import type { OutgoingPeerRequest } from '@/lib/peer-registration-store/types';
import { eventEmitter } from '@/lib/event-emitter';
import { getDefaultSecuritySettings } from '@/lib/security-utils';

const ME: bigint = 7n;
// A distinct peer per test: the store is a singleton and keeps what it records.
const RECORDED: bigint = 51n;
const SHAPE: bigint = 52n;
const QUIET: bigint = 53n;

const ownCid = async (): Promise<bigint | null> => ME;

beforeEach((): void => { h.sent = []; });

describe('a request from the Available list', () => {
  it('sends one PeerRegister from this session, by bigint CID, with the default settings', async () => {
    await autoRegisterPeer(ownCid, SHAPE, 'carol');

    expect(h.sent).toEqual([{
      PeerRegister: {
        request_id: expect.any(String),
        cid: ME,
        peer_cid: SHAPE,
        session_security_settings: getDefaultSecuritySettings(),
        connect_after_register: false,
        peer_session_password: null,
      },
    }]);
  });

  it('is recorded as ours, under the id it was sent with, so it is resent and their answer is recognised', async () => {
    await autoRegisterPeer(ownCid, RECORDED, 'bob');

    expect(peerRegistrationStore.hasOutgoingRequestTo(RECORDED, ME)).toBe(true);
    const sentId: unknown = (h.sent[0].PeerRegister as Record<string, unknown>).request_id;
    const mine: OutgoingPeerRequest | undefined = (await peerRegistrationStore.getOutgoingRequests()).find((r) => r.toCid === RECORDED);
    expect(mine).toMatchObject({ id: sentId, fromCid: ME, peerUsername: 'bob' });
  });

  it('does not announce the peer as registered before they accept', async () => {
    const heard: unknown[] = [];
    const off: () => void = eventEmitter.on('p2p:peer-registered', (e: unknown): void => { heard.push(e); });
    await autoRegisterPeer(ownCid, QUIET, 'dave');
    off();

    expect(h.sent).toHaveLength(1);
    expect(heard).toEqual([]);
  });

  it('sends nothing without a session', async () => {
    await expect(autoRegisterPeer(async (): Promise<null> => null, QUIET, 'dave')).rejects.toThrow('No CID provided for registration');
    expect(h.sent).toEqual([]);
  });
});
