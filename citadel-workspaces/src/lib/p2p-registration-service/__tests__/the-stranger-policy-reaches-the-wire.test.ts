/**
 * The policy's unit tests inject every effect; this runs the production wiring
 * (`handleIncomingRegistrationWithCid`) against the real settings module, the
 * real pending-request store and the real decline sender.
 *
 * One mock: `websocketService`, the process boundary to the local agent. It
 * records what would go on the wire and answers LocalDB reads the way an agent
 * with no stored auto-accept preference does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: { sent: Array<Record<string, unknown>> } = vi.hoisted((): { sent: Array<Record<string, unknown>> } => ({ sent: [] }));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: vi.fn((m: Record<string, unknown>): Promise<void> => { h.sent.push(m); return Promise.resolve(); }),
    sendLocalDBGet: vi.fn((): Promise<never> => Promise.reject(new Error('Key not found'))),
    sendLocalDBSet: vi.fn((): Promise<void> => Promise.resolve()),
    claimSession: vi.fn((): Promise<void> => Promise.resolve()),
  },
}));

import { handleIncomingRegistrationWithCid } from '../incoming-registration';
import { savePrivacySettings, DEFAULT_PRIVACY_SETTINGS } from '@/lib/privacy-settings';
import { peerRegistrationStore } from '@/lib/peer-registration-store';
import type { Peer, PendingRequestEntry } from '../types';

const ME: bigint = 7n;
// A distinct peer per test: the store is a singleton, and removing an entry
// persists, which the store refuses before it has ever read its stored list.
const REFUSED: bigint = 42n;
const QUEUED: bigint = 43n;
const CONTACT: bigint = 44n;

function responds(): Array<Record<string, unknown>> {
  return h.sent.map((m) => m.PeerRegisterRespond as Record<string, unknown> | undefined)
    .filter((r): r is Record<string, unknown> => r !== undefined);
}

beforeEach(() => {
  h.sent = [];
  localStorage.clear();
});

describe('an incoming request from a stranger, through the real wiring', () => {
  it('is refused on the wire and never queued when strangers are refused', async () => {
    savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS, acceptRequestsFromStrangers: false });

    await handleIncomingRegistrationWithCid(
      ME, REFUSED, 'mallory', new Map<string, PendingRequestEntry>(), new Map<bigint, Peer>(),
    );

    expect(responds()).toEqual([expect.objectContaining({ cid: ME, peer_cid: REFUSED, accept: false })]);
    expect(peerRegistrationStore.hasRequestFromPeer(REFUSED, ME)).toBe(false);
  });

  it('is queued for the user, and nothing is refused, when strangers are accepted', async () => {
    savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS, acceptRequestsFromStrangers: true });

    await handleIncomingRegistrationWithCid(
      ME, QUEUED, 'mallory', new Map<string, PendingRequestEntry>(), new Map<bigint, Peer>(),
    );

    expect(responds()).toEqual([]);
    expect(peerRegistrationStore.hasRequestFromPeer(QUEUED, ME)).toBe(true);
  });

  it('leaves an existing contact alone when strangers are refused', async () => {
    savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS, acceptRequestsFromStrangers: false });
    const contacts: Map<bigint, Peer> = new Map<bigint, Peer>([[CONTACT, {
      cid: CONTACT, username: 'mallory', fullName: 'mallory', isOnline: null, isRegistered: true,
    }]]);

    await handleIncomingRegistrationWithCid(
      ME, CONTACT, 'mallory', new Map<string, PendingRequestEntry>(), contacts,
    );

    expect(responds()).toEqual([]);
  });
});
