/**
 * Sharing a file offers it to each member over the existing P2P transfer, and
 * every member other than the sender comes back with an answer. The fan-out is
 * pure policy over injected I/O, so the real decision runs here; the only
 * doubles are the three facts the policy asks about (registration, presence,
 * the transfer service's send), each of which is a live network query.
 */
import { describe, it, expect } from 'vitest';
import type { GroupMember } from '@/types/group';
import type { GroupFileInfo, MemberDelivery } from '@/types/group-file-share';
import { fanOutFile, NOT_REGISTERED_REASON, type FanOutDeps } from '../group-file-fanout';
import { shareFileWithGroup, type ShareFileDeps } from '../share-file-with-group';
import type { PeerGroupDelivery } from '../peer-group-delivery';
import { MAX_BYTE_CONTENTS_BYTES } from '@/lib/file-transfer/server-upload';

const SELF: bigint = 1n;
const member = (cid: bigint, username: string): GroupMember => ({ cid, username, roleId: 'member', joinedAt: 0 });
const MEMBERS: GroupMember[] = [
  member(SELF, 'me'), member(2n, 'ada'), member(3n, 'bob'), member(4n, 'cy'), member(5n, 'dee'), member(6n, 'eve'),
];
const file: File = new File(['hello'], 'hello.txt', { type: 'text/plain' });

interface World { deps: ShareFileDeps; sent: string[]; announced: GroupFileInfo[]; own: PeerGroupDelivery[] }

function world(overrides: Partial<ShareFileDeps> = {}): World {
  const sent: string[] = [];
  const announced: GroupFileInfo[] = [];
  const own: PeerGroupDelivery[] = [];
  const deps: ShareFileDeps = {
    selfCid: SELF,
    // bob (3) never registered with us; dee (5) could not be established either way.
    isRegistered: (cid: bigint): boolean | null => (cid === 3n ? false : cid === 5n ? null : true),
    sendFile: async (recipient: string): Promise<string> => {
      sent.push(recipient);
      if (recipient === '6') throw new Error('agent refused the send');
      return `t-${recipient}`;
    },
    announce: async (_g: string, info: GroupFileInfo): Promise<string> => { announced.push(info); return 'msg-1'; },
    deliverOwn: (d: PeerGroupDelivery): void => { own.push(d); },
    now: (): number => 5_000,
    ...overrides,
  };
  return { deps, sent, announced, own };
}

describe('offering a file to every member', () => {
  it('answers for every other member: offered, skipped with a reason, or failed with one', async () => {
    const { deps, sent } = world();
    const deliveries: MemberDelivery[] = await fanOutFile(MEMBERS, file, deps as FanOutDeps);
    expect(deliveries).toEqual([
      { kind: 'offered', cid: 2n, username: 'ada', transferId: 't-2' },
      { kind: 'skipped', cid: 3n, username: 'bob', reason: NOT_REGISTERED_REASON },
      { kind: 'offered', cid: 4n, username: 'cy', transferId: 't-4' },
      { kind: 'offered', cid: 5n, username: 'dee', transferId: 't-5' },
      { kind: 'failed', cid: 6n, username: 'eve', reason: 'agent refused the send' },
    ]);
    expect(sent, 'never to self or an unregistered member; unknown registration is attempted').toEqual(['2', '4', '5', '6']);
  });

  it('keeps going after one member fails, and offers each member once', async () => {
    const { deps, sent } = world({
      sendFile: async (r: string): Promise<string> => { sent.push(r); if (r === '2') throw 'socket closed'; return `t-${r}`; },
    });
    const deliveries: MemberDelivery[] = await fanOutFile([...MEMBERS, member(5n, 'dee')], file, deps);
    expect(deliveries.map((d: MemberDelivery): string => `${d.username}:${d.kind}`))
      .toEqual(['ada:failed', 'bob:skipped', 'cy:offered', 'dee:offered', 'eve:offered']);
    expect(sent).toEqual(['2', '4', '5', '6']);
  });

  it('sends one member at a time', async () => {
    let inFlight: number = 0;
    let peak: number = 0;
    const { deps } = world({
      sendFile: async (r: string): Promise<string> => {
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 1); });
        inFlight -= 1;
        return `t-${r}`;
      },
    });
    await fanOutFile(MEMBERS, file, deps);
    expect(peak).toBe(1);
  });
});

describe('sharing into the group', () => {
  it('announces once, then places the sender\'s copy with the complete ledger', async () => {
    const { deps, announced, own } = world();
    const result: { messageId: string; deliveries: MemberDelivery[] } = await shareFileWithGroup('7:42', MEMBERS, file, deps);
    expect(announced).toEqual([{ name: 'hello.txt', size: 5, mimeType: 'text/plain' }]);
    expect(own).toHaveLength(1);
    expect(own[0].messageId).toBe('msg-1');
    expect(own[0].fileShare?.senderCid).toBe(SELF);
    expect(own[0].fileShare?.deliveries).toEqual(result.deliveries);
    expect(result.deliveries).toHaveLength(5);
  });

  it('sends nothing to anyone when the announcement fails', async () => {
    const { deps, sent, own } = world({ announce: async (): Promise<string> => { throw new Error('not in group'); } });
    await expect(shareFileWithGroup('7:42', MEMBERS, file, deps)).rejects.toThrow('not in group');
    expect(sent).toEqual([]);
    expect(own).toEqual([]);
  });

  it('refuses an empty or oversized file before telling anybody of it', async () => {
    const { deps, announced } = world();
    await expect(shareFileWithGroup('7:42', MEMBERS, new File([], 'empty.txt'), deps)).rejects.toThrow('is empty');
    const big: File = new File([new Uint8Array(MAX_BYTE_CONTENTS_BYTES + 1)], 'big.bin');
    await expect(shareFileWithGroup('7:42', MEMBERS, big, deps)).rejects.toThrow('capped');
    expect(announced).toEqual([]);
  });
});
