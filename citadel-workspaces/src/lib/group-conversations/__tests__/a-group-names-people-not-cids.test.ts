/**
 * A group names people, never their CIDs.
 *
 * Seen on the live bench: an invitee's page titled the group
 * "14768729968876999829's Group", and every message from another member was
 * signed "14768729968876999829" with an avatar reading "1".
 *
 * The wire names peers only by CID, so group-response-service resolved them
 * against the registration roster itself -- with `cid.toString()` as the
 * fallback. Any peer the roster had not loaded yet (a page just reloaded, a
 * member you never registered with directly) was named by twenty digits, and
 * `buildGroupFromInvite` then built the default title out of them.
 *
 * The roster lookup already existed, with the right fallback, for calls. This
 * checks the group path now asks the same question.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encode } from 'cbor-x';
import { peerDisplayName } from '@/lib/peer-display';

const SELF: bigint = 7n;
const ALICE: bigint = 14768729968876999829n;

// The roster is a network-backed singleton; this is the seam between the
// naming rule and the service that fills it. Each test decides what it holds.
const roster: { registered: Array<{ cid: bigint; username: string; fullName: string }> } = { registered: [] };
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: {
    getPeers: (): unknown => ({ registeredPeers: roster.registered, allPeers: [] }),
  },
}));
// Who this tab is: an I/O read of the tab's stored selection.
vi.mock('@/lib/tab-context', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, getSelectedUser: async (): Promise<unknown> => ({ selectedUsername: 'bob' }) };
});
vi.mock('@/lib/connection', async (importOriginal: () => Promise<typeof import('@/lib/connection')>) => {
  const actual: typeof import('@/lib/connection') = await importOriginal();
  const { doubleOf } = await import('@/test/singleton-double');
  return { ...actual, connectionManager: doubleOf(actual.connectionManager, { getConnectionInfo: ((): { cid: bigint } => ({ cid: SELF })) as never }) };
});

const { eventEmitter } = await import('@/lib/event-emitter');
const { startGroupResponseService } = await import('../group-response-service');
startGroupResponseService();

/** The next emission of `name`, driven by one websocket message. */
async function next(name: string, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const handler = (payload: Record<string, unknown>): void => {
      eventEmitter.off(name, handler);
      resolve(payload);
    };
    eventEmitter.on(name, handler);
    eventEmitter.emit('websocket-message', message);
  });
}

const invite: Record<string, unknown> = {
  GroupInviteNotification: { cid: SELF, peer_cid: ALICE, group_key: { cid: ALICE, mgid: 3n }, request_id: null },
};

function groupMessage(): Record<string, unknown> {
  const body: Uint8Array = encode({
    group_id: `${ALICE}:3`, message_id: 'm1', sender_cid: ALICE, content: 'hi', timestamp: 1,
  });
  return {
    GroupMessageNotification: {
      cid: SELF, peer_cid: ALICE, message: Array.from(body), group_key: { cid: ALICE, mgid: 3n }, request_id: null,
    },
  };
}

beforeEach((): void => { roster.registered = []; });

describe('who a group says sent something', () => {
  it('does not name an inviter the roster has not loaded by their CID', async () => {
    const payload: Record<string, unknown> = await next('group:invite-received', invite);
    expect(payload.inviterUsername).not.toContain(ALICE.toString());
    expect(payload.inviterUsername).toBe(peerDisplayName({ cid: ALICE }));
  });

  it('names an inviter the roster knows by their display name', async () => {
    // Positive control: the fallback must not outrank a real name.
    roster.registered = [{ cid: ALICE, username: 'alice0924', fullName: 'Alice' }];
    const payload: Record<string, unknown> = await next('group:invite-received', invite);
    expect(payload.inviterUsername).toBe('Alice');
  });

  it('signs a peer-group message with a name, not twenty digits', async () => {
    const unknown: Record<string, unknown> = await next('group:message-received', groupMessage());
    expect(unknown.senderName).not.toContain(ALICE.toString());

    roster.registered = [{ cid: ALICE, username: 'alice0924', fullName: '' }];
    const known: Record<string, unknown> = await next('group:message-received', groupMessage());
    expect(known.senderName).toBe('alice0924');
  });
});

describe("an invitee's default title", () => {
  it('is built from the inviter’s name', async () => {
    const { buildGroupFromInvite } = await import('@/hooks/use-group-state-invite');
    const payload: Record<string, unknown> = await next('group:invite-received', invite);
    const group: { name: string } | null = await buildGroupFromInvite(payload as never);
    expect(group?.name).not.toContain(ALICE.toString());
    expect(group?.name).toBe(`${peerDisplayName({ cid: ALICE })}'s Group`);
  });
});
