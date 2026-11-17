/**
 * TEST RIG: one member's Calendar over the real glue gate and ports, a shared in-memory store, a
 * hand-moved clock, a StorageChanged feed the test pushes into, and the member's notification
 * settings applied as the page applies them (notice-gate.ts). The notify port, the store and the
 * clock are the stand-ins; what the Calendar decides to raise is the shipped code.
 */
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance, type StorageChange, type GlueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY, type IhttpLimits } from '@/lib/citadel-apps/host/limits';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { withNoticePrefs } from '../notice-gate';
import { calendarPorts, type CalendarPorts } from '../ports';
import { MemoryStore } from './memory-store';

const HELD: Capability[] = ['storage.user', 'storage.node', 'storage.node.authored', 'notifications'];
const POLICY: { serverCallsPerSecond: number; memoryMaxPages: number; computeBudgetMs: number; hostNetTimeoutMs: number; serverNetTimeoutMs: number; portTimeoutMs: number; hostCallsPerSecond: number; maxLiveInstancesPerPage: number; maxRequestBytes: number; maxReplyBytes: number; maxLiveReplies: number; replyTtlMs: number; maxLogBytes: number; peerAuthorizationsPerSecond: number; ihttp: IhttpLimits; } = { ...STANDARD_HOST_POLICY, serverCallsPerSecond: 100_000 };

export interface NoticeMember {
  /** Under the member's settings, as the page binds them. */
  readonly ports: CalendarPorts;
  readonly store: MemoryStore;
  readonly clock: ManualClock;
  /** What reached the page's notification list, as `title: body`. */
  readonly notes: string[];
  /** Whether each notice raised was allowed to reach the system, in order. */
  readonly system: boolean[];
  readonly hear: (change: StorageChange) => void;
}

export function noticeMember(name: string, shared: Map<string, Uint8Array>, startMs: number, held: Capability[] = HELD): NoticeMember {
  const notes: string[] = [];
  const system: boolean[] = [];
  const listeners: Set<(change: StorageChange) => void> = new Set();
  const store: MemoryStore = new MemoryStore(name, shared);
  const clock: ManualClock = new ManualClock(startMs);
  const glue: GlueInstance = glueInstance({
    appId: 'net.avarok.calendar', held: new Set<Capability>(held), policy: POLICY, limits: { topics: null, p2p: null },
    ports: { storage: store.port(), notify: { Notify: ({ title, body }) => { notes.push(`${title}: ${body}`); return { ok: null }; } } },
    clock, pageUrl: 'https://w.example/n1',
    storageChanges: (listener: (change: StorageChange) => void) => { listeners.add(listener); return (): void => { listeners.delete(listener); }; },
  });
  const ports: CalendarPorts = withNoticePrefs(calendarPorts(glue), (s: boolean): void => { system.push(s); });
  return { ports, store, clock, notes, system, hear: (change: StorageChange): void => listeners.forEach((l) => l(change)) };
}

/** Lets every queued turn run, over several macrotasks: each change heard waits on the one before it. */
export async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i += 1) await new Promise<void>((r) => { setTimeout(r, 0); });
}
