/**
 * A `cal` change crosses the production topic path both ways (cal-topic.ts over the glue gate and
 * runtime/topic-port.ts): one member's announce leaves as a group message in the topic's envelope,
 * within the Calendar's topic limits; delivered to another member's topic port as the agent
 * delivers it from a sender the kernel admits, it reaches their `listenCal` as the same
 * `{ node, key }`; and the bytes on the wire carry nothing of the event.
 *
 * TEST FAKE: the agent is an in-memory AgentLink that answers each request with its Success, the
 * ports' one I/O boundary; the kernel answers who holds the group and admits the sender. The gate,
 * the topic port, its envelope and the Calendar's codec are the production ones.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import type { AgentLink } from '@/lib/citadel-apps/runtime/agent-link';
import { InstallPlaneRegistry } from '@/lib/citadel-apps/runtime/install-plane-registry';
import { PeerAuthority } from '@/lib/citadel-apps/runtime/peer-authority';
import { topicPort, type OwnedTopicPort } from '@/lib/citadel-apps/runtime/topic-port';
import { announce, CAL_TOPIC, listenCal } from '../cal-topic';
import type { CalChange } from '../generated/CalChange';
import { calendarPorts, type CalendarPorts } from '../ports';
import { realEngine } from './engine-rig';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
/** The Calendar's topic limits (design 3.5): 1 KiB a message, two a second. */
const LIMITS: { max_msg_bytes: number; max_msgs_per_s: number; } = { max_msg_bytes: 1024, max_msgs_per_s: 2 };
const SUCCESS: Readonly<Record<string, string>> = { GroupRequestJoin: 'GroupRequestJoinSuccess', GroupMessage: 'GroupMessageSuccess', GroupLeave: 'GroupLeaveSuccess' };
const GROUP: { cid: bigint; mgid: bigint; } = { cid: 5n, mgid: 9n };

interface Seat {
  readonly ports: CalendarPorts;
  readonly messages: number[][];
  readonly deliver: (fromCid: bigint, message: number[]) => Promise<void>;
}

function seat(cid: bigint, username: string): Seat {
  const handlers: Set<(m: unknown) => void> = new Set();
  const messages: number[][] = [];
  let n: number = 0;
  const agent: AgentLink = {
    newRequestId: () => `${username}-${++n}`,
    listen: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: async (request: Record<string, unknown>) => {
      const [variant, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
      if (variant === 'GroupMessage') messages.push(body.message as number[]);
      queueMicrotask(() => handlers.forEach((h) => h({ [SUCCESS[variant] as string]: { cid, request_id: body.request_id, group_key: GROUP } })));
    },
  };
  const port: OwnedTopicPort = topicPort({
    seat: new InstallPlaneRegistry().attach(`inst-${username}`, 'net.avarok.calendar'), cid, agent, topics: [CAL_TOPIC], limits: LIMITS, timeoutMs: 1000,
    authority: new PeerAuthority(async (peerCid: bigint) => ({ ok: true, peer: { username: peerCid === 100n ? 'amy' : 'bob', cid: peerCid, app_id: 'net.avarok.calendar', install_id: 'i1' }, untilMs: 60_000n }), () => 0, 30),
    topicGroup: async () => '5:9', record: { group: () => {}, request: () => {} }, refused: () => {},
  });
  const ports: CalendarPorts = calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', ports: { topic: port }, held: new Set<Capability>(['group.topic.subscribe', 'group.topic.publish']),
    policy: STANDARD_HOST_POLICY, limits: { topics: LIMITS, p2p: null }, clock: new ManualClock(), pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  }));
  const deliver = async (fromCid: bigint, message: number[]): Promise<void> => {
    handlers.forEach((h) => h({ GroupMessageNotification: { cid, peer_cid: fromCid, group_key: GROUP, message, request_id: null } }));
    await new Promise<void>((r) => setTimeout(r, 0));
  };
  return { ports, messages, deliver };
}

const settle = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

describe('a cal change over the real topic port', () => {
  it("leaves one member's window in the topic's envelope and reaches another's listenCal as the same change", async () => {
    const amy: Seat = seat(100n, 'amy');
    const bob: Seat = seat(200n, 'bob');
    const heard: { change: CalChange }[] = [];
    const leave: () => void = listenCal(bob.ports, engine, (change: CalChange): void => { heard.push({ change }); });
    await amy.ports.topics.open(CAL_TOPIC);
    await settle();
    // The longest a change gets: a node id and an event id of 36 characters each, under the inherit prefix.
    const change: CalChange = { node: 'n'.repeat(36), key: `cal/inherit/${'a'.repeat(36)}/${'e'.repeat(36)}` };
    await announce(amy.ports, engine, change);
    expect(amy.messages).toHaveLength(1);
    const wire: number[] = amy.messages[0] as number[];
    expect(wire.length).toBeLessThanOrEqual(LIMITS.max_msg_bytes + 64);
    await bob.deliver(100n, wire);
    expect(heard).toEqual([{ change }]);
    leave();
  });

  it('carries nothing but the node and the key', async () => {
    const amy: Seat = seat(100n, 'amy');
    await amy.ports.topics.open(CAL_TOPIC);
    await settle();
    await announce(amy.ports, engine, { node: 'n1', key: 'cal/event/standup' });
    const text: string = new TextDecoder().decode(new Uint8Array(amy.messages[0] as number[]));
    expect(text).toContain('cal/event/standup');
    // The envelope names its own fields (`body` among them); the change inside names no event's.
    expect(text).not.toMatch(/title|Standup|amy|hosts/);
  });
});
