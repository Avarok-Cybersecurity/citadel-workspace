/**
 * The group-state envelope travels on the chat transport and must never be
 * read as chat -- by this build, or by one that predates it.
 *
 * Old builds: `decodeGroupMessage` has always required `content` to be a
 * string, and the inbound path drops a body that does not decode. The control
 * envelope carries no `content`, so an old client drops it silently rather than
 * printing a CBOR map as a message. The first test pins that property on the
 * bytes themselves, so adding a `content` field later fails here.
 */
import { describe, it, expect } from 'vitest';
import { decode as cborDecode } from 'cbor-x';
import { encodeGroupControl, decodeGroupControl, type PeerGroupControl } from '../group-control-codec';
import { decodeGroupMessage, encodeGroupMessage } from '../group-message-codec';
import { toGroupEvents, type GroupEvent } from '../group-events';
import { createDefaultRoles } from '@/types/group';

const OWNER: bigint = 11n;
const MEMBER: bigint = 22n;
const SELF: bigint = 33n;

function control(overrides: Partial<PeerGroupControl> = {}): PeerGroupControl {
  const roles: ReturnType<typeof createDefaultRoles> = createDefaultRoles();
  return {
    group_id: `${OWNER}:5`,
    message_id: 'c1',
    sender_cid: OWNER,
    timestamp: 1,
    control: { name: 'Renamed', settings: { roles, defaultRoleId: roles[2].id }, assignments: [{ cid: MEMBER, role_id: roles[1].id }] },
    ...overrides,
  };
}

function notification(from: bigint, bytes: Uint8Array): Record<string, unknown> {
  return {
    GroupMessageNotification: {
      cid: SELF, peer_cid: from, message: Array.from(bytes), group_key: { cid: OWNER, mgid: 5n }, request_id: null,
    },
  };
}

const events = (n: Record<string, unknown>): GroupEvent[] => toGroupEvents(n, SELF, 'bob', () => 'someone');

describe('what an older client sees', () => {
  it('has no content field, so the pre-envelope decoder rejects it', () => {
    const raw: Record<string, unknown> = cborDecode(encodeGroupControl(control())) as Record<string, unknown>;
    expect('content' in raw).toBe(false);
    expect(decodeGroupMessage(encodeGroupControl(control()))).toBeNull();
  });
});

describe('what this client sees', () => {
  it('round-trips the name, the roles and the assignments', () => {
    const sent: PeerGroupControl = control();
    expect(decodeGroupControl(encodeGroupControl(sent))).toEqual(sent);
  });

  it('becomes a control event and never a chat message', () => {
    const out: GroupEvent[] = events(notification(OWNER, encodeGroupControl(control())));
    expect(out.map((e) => e.name)).toEqual(['group:control-received']);
    expect(out[0].payload).toMatchObject({ groupId: `${OWNER}:5`, senderCid: OWNER, ownerCid: OWNER });
  });

  it('is judged by who the protocol says sent it, not by the envelope', () => {
    const out: GroupEvent[] = events(notification(MEMBER, encodeGroupControl(control({ sender_cid: OWNER }))));
    expect(out[0].payload).toMatchObject({ senderCid: MEMBER });
  });

  it('is not chat even when it also carries text', () => {
    const bytes: Uint8Array = encodeGroupControl({ ...control(), content: 'sneaky' } as PeerGroupControl);
    expect(decodeGroupMessage(bytes)).toBeNull();
    expect(events(notification(OWNER, bytes)).some((e) => e.name === 'group:message-received')).toBe(false);
  });

  it('is refused whole when a role in it is malformed', () => {
    const bad: PeerGroupControl = control();
    const roles: unknown[] = [...(bad.control.settings?.roles ?? []), { id: 'x', name: 'x' }];
    const bytes: Uint8Array = encodeGroupControl({ ...bad, control: { ...bad.control, settings: { roles, defaultRoleId: 'x' } } } as unknown as PeerGroupControl);
    expect(decodeGroupControl(bytes)).toBeNull();
  });

  it('leaves ordinary chat alone', () => {
    const chat: Uint8Array = encodeGroupMessage({ group_id: `${OWNER}:5`, message_id: 'm', sender_cid: OWNER, content: 'hi', timestamp: 1 });
    expect(decodeGroupControl(chat)).toBeNull();
    expect(events(notification(OWNER, chat)).map((e) => e.name)).toEqual(['group:message-received']);
  });
});
