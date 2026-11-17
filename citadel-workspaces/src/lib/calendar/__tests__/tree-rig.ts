/**
 * TEST RIG: several members' Calendars over one workspace: one shared in-memory KV
 * (memory-store.ts), one page tree answered by the real `nodes.read` port (nodes-port.ts), and one
 * `cal` topic group that hands each message to every other member who joined it. Each member's
 * calls go through the real ports and gate, so a right the store takes away is refused as the
 * kernel refuses it.
 */
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY, type HostPolicy } from '@/lib/citadel-apps/host/limits';
import type { TopicArrival, TopicPort } from '@/lib/citadel-apps/host/ports';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { treeNodesPort, type TreeNode } from '@/lib/citadel-apps/runtime/nodes-port';
import { calendarPorts, type CalendarPorts } from '../ports';
import { MemoryStore } from './memory-store';

/**
 * The page's server-call pace is proven in a-glue-app-never-outruns-the-one-server-rate.test.ts;
 * here it would only make a walk of the tree wait on a clock no one advances, so it is lifted.
 */
const POLICY: HostPolicy = { ...STANDARD_HOST_POLICY, serverCallsPerSecond: 100_000 };

const HELD: Capability[] = ['storage.user', 'storage.node', 'storage.node.authored', 'nodes.read', 'group.topic.subscribe', 'group.topic.publish'];

/** A tree from `child: parent` pairs; a parent of null is a root. */
export function treeOf(parents: Record<string, string | null>): Record<string, TreeNode> {
  const nodes: Record<string, TreeNode> = {};
  for (const [id, parent] of Object.entries(parents)) {
    const children: string[] = Object.entries(parents).filter(([, p]) => p === id).map(([c]) => c);
    nodes[id] = { id, name: id.toUpperCase(), parent_id: parent, children };
  }
  return nodes;
}

/** The one `cal` group: who joined it, and what each joined member hears. */
export class TopicGroup {
  private readonly joined: Map<string, Set<(a: TopicArrival) => void>> = new Map();
  readonly sent: { from: string; body: Uint8Array }[] = [];

  port(me: string): TopicPort {
    const listeners: Set<(a: TopicArrival) => void> = new Set();
    return {
      TopicOpen: ({ name }): { ok: { name: string; members: string[]; }; } => {
        this.joined.set(me, listeners);
        return { ok: { name, members: [...this.joined.keys()] } };
      },
      TopicPublish: ({ name, body }): { ok: null; } => {
        this.sent.push({ from: me, body });
        for (const [who, hear] of this.joined) {
          if (who === me) continue;
          const from: { username: string; cid: bigint; app_id: string; install_id: string; via: "group"; } = { username: me, cid: 1n, app_id: 'net.avarok.calendar', install_id: 'i1', via: 'group' as const };
          for (const l of hear) l({ name, event: { message: { from, body } } });
        }
        return { ok: null };
      },
      TopicClose: (): { ok: null; } => {
        this.joined.delete(me);
        return { ok: null };
      },
      onEvent: (listener) => {
        listeners.add(listener);
        return (): void => { listeners.delete(listener); };
      },
    };
  }
}

export interface Member {
  readonly store: MemoryStore;
  readonly ports: CalendarPorts;
}

export function member(me: string, values: Map<string, Uint8Array>, tree: Record<string, TreeNode>, group: TopicGroup): Member {
  const store: MemoryStore = new MemoryStore(me, values);
  const ports: CalendarPorts = calendarPorts(glueInstance({
    appId: 'net.avarok.calendar',
    ports: { storage: store.port(), nodes: treeNodesPort('Workspace', () => tree), topic: group.port(me) },
    held: new Set<Capability>(HELD), policy: POLICY,
    limits: { topics: { max_msg_bytes: 1024, max_msgs_per_s: 2 }, p2p: null },
    clock: new ManualClock(Date.now()), pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  }));
  return { store, ports };
}
