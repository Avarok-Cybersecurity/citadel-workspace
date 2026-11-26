/**
 * The page's announcer of a member's own-store writes (own-store-writes.ts), on its own: what it
 * announces, what it reads off the channel, and when it opens the channel. The channel here is a
 * recording stand-in, so a test can hand it a message no real window would send; the real
 * BroadcastChannel is crossed in calendar/__tests__/the-calendar-hears-its-own-private-writes.
 */
import { describe, expect, it } from 'vitest';
import type { StorageChange } from '../../host/glue-instance';
import type { PortAnswer, StoragePort } from '../../host/ports';
import { announcingStorage, ownWrites, type OwnWrites, type OwnWritesChannel } from '../own-store-writes';

interface Recorded extends OwnWritesChannel {
  readonly posted: unknown[];
  readonly arrive: (message: unknown) => void;
}

function recorded(): Recorded {
  const posted: unknown[] = [];
  let listener: (m: unknown) => void = (): void => {};
  return { posted, postMessage: (m: unknown): void => { posted.push(m); }, onMessage: (l: (m: unknown) => void): void => { listener = l; }, arrive: (m: unknown): void => listener(m) };
}

/** A store that answers every write with `answer`. */
function answering(answer: PortAnswer<null>): StoragePort {
  const no: PortAnswer<never> = { refused: { unavailable: 'test' } };
  return { KvGet: () => no, KvList: () => no, KvListAuthored: () => no, KvSet: () => answer, KvSetMany: () => answer, KvDelete: () => answer };
}

describe("a member's own-store writes", () => {
  it('opens no channel until an instance writes or listens', () => {
    let opens: number = 0;
    const ch: Recorded = recorded();
    const own: OwnWrites = ownWrites(1n, (): OwnWritesChannel => { opens += 1; return ch; });
    expect(opens).toBe(0);
    own.listen('i', (): void => {});
    own.announce({ installId: 'i', backend: 'user', keys: ['k'] });
    expect(opens).toBe(1);
  });

  it("announces only an answered write to `user` or `local`, naming the member, install and keys", async () => {
    const ch: Recorded = recorded();
    const own: OwnWrites = ownWrites(1n, () => ch);
    const ok: StoragePort = announcingStorage(answering({ ok: null }), 'i', own);
    const refused: StoragePort = announcingStorage(answering({ refused: { limit: 'quota' } }), 'i', own);
    await refused.KvSet({ backend: 'user', key: 'no', value: new Uint8Array() });
    await ok.KvSet({ backend: 'scope', key: 'shared', value: new Uint8Array() });
    await ok.KvDelete({ backend: { node: { node_id: 'n' } }, key: 'kernels' });
    await ok.KvSetMany({ backend: 'local', entries: [{ key: 'a', value: new Uint8Array() }, { key: 'b', value: new Uint8Array() }] });
    expect(ch.posted).toEqual([{ member: 1n, installId: 'i', backend: 'local', keys: ['a', 'b'] }]);
  });

  it("hears only well-formed writes for its own member and install", () => {
    const ch: Recorded = recorded();
    const heard: StorageChange[] = [];
    ownWrites(1n, () => ch).listen('i', (c: StorageChange): void => { heard.push(c); });
    ch.arrive({ member: 2n, installId: 'i', backend: 'user', keys: ['other-member'] });
    ch.arrive({ member: 1n, installId: 'j', backend: 'user', keys: ['other-install'] });
    ch.arrive({ member: '1', installId: 'i', backend: 'user', keys: ['string-member'] });
    ch.arrive({ member: 1n, installId: 'i', backend: 'scope', keys: ['not-own'] });
    ch.arrive({ member: 1n, installId: 'i', backend: 'user', keys: [3] });
    ch.arrive(null);
    ch.arrive({ member: 1n, installId: 'i', backend: 'local', keys: ['x', 'y'] });
    expect(heard).toEqual([{ backend: 'local', key: 'x' }, { backend: 'local', key: 'y' }]);
  });
});
