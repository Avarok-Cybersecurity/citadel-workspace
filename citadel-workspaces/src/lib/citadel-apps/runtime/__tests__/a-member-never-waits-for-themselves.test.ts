/**
 * Who a member waiting on a topic is told they wait for (topic-owner.ts): the group's creator as the
 * kernel names them, and never this session itself, even when the kernel would name it.
 *
 * TEST FAKE: the kernel's AuthorizePeer is an injected function behind the production PeerAuthority.
 */
import { describe, expect, it } from 'vitest';
import type { PeerAuthorization } from '../../member-consent-types';
import { PeerAuthority } from '../peer-authority';
import { ownerOf } from '../topic-owner';

const ME: bigint = 100n;
// Test default: the kernel names every peer it is asked about, this session included.
const names = (): { authority: PeerAuthority; asked: bigint[] } => {
  const asked: bigint[] = [];
  const authority: PeerAuthority = new PeerAuthority(async (peerCid: bigint): Promise<PeerAuthorization> => {
    asked.push(peerCid);
    return { ok: true, peer: { username: peerCid === ME ? 'me' : 'amy', cid: peerCid, app_id: 'a', install_id: 'i' }, untilMs: 60_000n };
  }, () => 0, 30);
  return { authority, asked };
};

describe('who a topic join waits for', () => {
  it("is the group's creator, by the kernel's name for them", async () => {
    const { authority } = names();
    expect(await ownerOf('5:9', 'cal', ME, authority)).toEqual({ username: 'amy', cid: 5n });
  });

  it('is never this session, so a lone member is not told to wait for themselves', async () => {
    const { authority, asked } = names();
    expect(await ownerOf(`${ME}:9`, 'cal', ME, authority)).toBeNull();
    expect(asked).toEqual([]);
  });

  it('is nobody when the kernel holds no group or would not say', async () => {
    const { authority } = names();
    expect(await ownerOf(null, 'cal', ME, authority)).toBeNull();
    expect(await ownerOf('refused', 'cal', ME, authority)).toBeNull();
  });
});
