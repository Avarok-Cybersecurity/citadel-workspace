/**
 * A tree navigation rebinds the Calendar's glue instance: the instance is closed and its host leaves
 * every topic it held (runtime/glue-steps.ts, topic-port.ts `closeAll`), while the pane's own leave
 * (cal-topic.ts) is still queued behind the instance's pacing and reaches it closed. That refusal is
 * the leave already done: the group is left once, by the host, and nothing is reported. A leave
 * refused for any other reason is still reported.
 *
 * TEST FAKE: the agent is an in-memory AgentLink that answers each request with its Success, the
 * ports' one I/O boundary; the kernel holds no group, so this member creates it. The gate, the
 * topic port, the Calendar's ports and its codec are the production ones.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance, type GlueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { ManualClock, oneClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import type { AgentLink } from '@/lib/citadel-apps/runtime/agent-link';
import { InstallPlaneRegistry } from '@/lib/citadel-apps/runtime/install-plane-registry';
import { PeerAuthority } from '@/lib/citadel-apps/runtime/peer-authority';
import { topicPort, type OwnedTopicPort } from '@/lib/citadel-apps/runtime/topic-port';
import type { RequestType, ResponseType } from 'citadel-workspace-client-ts';
import { CAL_TOPIC, listenCal } from '../cal-topic';
import { calendarPorts } from '../ports';
import { realEngine } from './engine-rig';

const ME: bigint = 100n;
const LIMITS: { max_msg_bytes: number; max_msgs_per_s: number } = { max_msg_bytes: 1024, max_msgs_per_s: 2 };
const SUCCESS: Readonly<Partial<Record<RequestType, ResponseType>>> = { GroupCreateAppTopic: 'GroupCreateSuccess', GroupLeave: 'GroupLeaveSuccess' };

interface Mounted {
  readonly glue: GlueInstance;
  readonly port: OwnedTopicPort;
  readonly sent: string[];
}

function mounted(held: readonly Capability[]): Mounted {
  const handlers: Set<(m: unknown) => void> = new Set();
  const sent: string[] = [];
  let n: number = 0;
  const agent: AgentLink = {
    newRequestId: () => `req-${++n}`,
    listen: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: async (request: Record<string, unknown>) => {
      const [variant, body] = Object.entries(request)[0] as [RequestType, Record<string, unknown>];
      sent.push(variant);
      queueMicrotask(() => handlers.forEach((h) => h({ [SUCCESS[variant] as string]: { cid: ME, request_id: body.request_id, group_key: { cid: ME, mgid: 1n } } })));
    },
  };
  const port: OwnedTopicPort = topicPort({
    seat: new InstallPlaneRegistry().attach('cal', 'net.avarok.calendar'), cid: ME, agent, topics: [CAL_TOPIC], limits: LIMITS, timeoutMs: 1000,
    authority: new PeerAuthority(async () => ({ ok: false, why: 'NoHost' }), () => 0, 30),
    topicGroup: async (_t: string, claim: string | null) => claim, record: { group: () => {}, request: () => {} }, refused: () => {}, notAMember: () => {},
  });
  const glue: GlueInstance = glueInstance({
    appId: 'net.avarok.calendar', ports: { topic: port }, held: new Set<Capability>(held),
    policy: STANDARD_HOST_POLICY, limits: { topics: LIMITS, p2p: null }, ...oneClock(new ManualClock()), pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  });
  return { glue, port, sent };
}

const settle = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => { vi.restoreAllMocks(); });

describe("the cal topic's leave", () => {
  it('is the host\'s alone when the instance ends first, and says nothing', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m: Mounted = mounted(['group.topic.subscribe', 'group.topic.publish']);
    const leave: () => void = listenCal(calendarPorts(m.glue), realEngine(), () => undefined);
    await settle();
    expect(m.sent).toContain('GroupCreateAppTopic');
    // As a rebind closes it: the pane's leave is queued, then the instance closes and its host leaves.
    leave();
    m.glue.close();
    await m.port.closeAll();
    await settle();
    expect(m.sent.filter((v) => v === 'GroupLeave')).toHaveLength(1);
    expect(warned).not.toHaveBeenCalled();
  });

  it('is still reported when it is refused for another reason', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m: Mounted = mounted([]);
    const leave: () => void = listenCal(calendarPorts(m.glue), realEngine(), () => undefined);
    await settle();
    leave();
    await settle();
    expect(warned.mock.calls.map((c) => String(c[0]))).toContain('[calendar] the cal topic could not be left');
  });
});
