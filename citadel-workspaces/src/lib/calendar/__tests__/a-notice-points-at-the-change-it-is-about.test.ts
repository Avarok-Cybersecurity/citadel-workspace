/**
 * What the Calendar tells a member about names the change it is about when that change is in
 * someone's own namespace, so the host can say who it is from (the host names them only if the
 * server told it of that change). A change in a node's shared store names no one. The real
 * `tellAbout`; stand-ins: the storage and notify ports, and the engine's decoders (pure codecs).
 */
import { describe, it, expect } from 'vitest';
import type { NotifyAbout } from '@/lib/citadel-apps/sdk/generated/NotifyAbout';
import { tellAbout, type TellDeps } from '../invite-notices';
import type { Event } from '../generated/Event';
import type { Poll } from '../generated/Poll';
import { POLL_PREFIX } from '../polls';
import { EVENT_PREFIX } from '../read-sources';

type Told = { kind: string; about: NotifyAbout | null };

function deps(decoded: unknown): { d: TellDeps; told: Told[] } {
  const told: Told[] = [];
  const kept: Map<string, Uint8Array> = new Map<string, Uint8Array>();
  const d: TellDeps = {
    ports: {
      storage: {
        get: async (_store: unknown, key: string): Promise<Uint8Array | null> => kept.get(key) ?? (key.startsWith('cal/told/') ? null : new Uint8Array([1])),
        set: async (_store: unknown, key: string, value: Uint8Array): Promise<void> => { kept.set(key, value); },
      },
      notify: async (kind: string, _title: string, _body: string, about: NotifyAbout | null): Promise<void> => { told.push({ kind, about }); },
    },
    engine: { decodeEvent: (): unknown => decoded, team: { decodePoll: (): unknown => decoded } },
    me: 'ana',
    nodeName: (): string => 'Platform',
    when: (): string => 'Fri 10:00',
  } as unknown as TellDeps;
  return { d, told };
}

const poll: Pick<Poll, 'id' | 'type_id' | 'host' | 'title' | 'state'> = { id: 'p1', type_id: 't', host: 'bo', title: 'Retro', state: 'open' };
const invitation: Pick<Event, 'id' | 'author' | 'title' | 'kind' | 'status' | 'invitees'> = { id: 'e1', author: 'bo', title: 'Retro', kind: 'plain', status: 'confirmed', invitees: [{ member: { username: 'ana' } }] };

describe('the change a Calendar notice is about', () => {
  it('is named when it is in its author\'s own namespace', async () => {
    const { d, told } = deps(poll);
    await tellAbout({ backend: { node_authored: { node_id: 'n', author: 'bo' } }, key: `${POLL_PREFIX}p1` }, d);
    expect(told).toEqual([{ kind: 'polls', about: { node_id: 'n', author: 'bo', key: `${POLL_PREFIX}p1` } }]);
  });

  it('is no one\'s when it is in the node\'s shared store', async () => {
    const { d, told } = deps(invitation);
    await tellAbout({ backend: { node: { node_id: 'n' } }, key: `${EVENT_PREFIX}e1` }, d);
    expect(told).toEqual([{ kind: 'invitations', about: null }]);
  });
});
