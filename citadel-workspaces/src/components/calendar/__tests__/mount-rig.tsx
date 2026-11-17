/**
 * TEST RIG: the Calendar tab as the registry mounts it, over the real ports and gate and an
 * in-memory store signed in as `me`, with a hook to push the kernel's StorageChanged. The test
 * file mocks the core's loader (jsdom cannot fetch the binary); see the mount tests.
 */
import { render } from '@testing-library/react';
import type { AppInstall, AppManifest } from 'citadel-workspace-client-ts';
import { WorkspaceContext, type WorkspaceState } from '@/contexts/WorkspaceContext';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance, type GlueInstance, type StorageChange } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY, type IhttpLimits } from '@/lib/citadel-apps/host/limits';
import type { IhttpPort } from '@/lib/citadel-apps/host/ports';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import { CalendarMount } from '../CalendarMount';

/**
 * The page's server-call pace is proven in a-glue-app-never-outruns-the-one-server-rate.test.ts; on
 * this rig's clock, which no one advances, it would leave a call waiting for good once a mounted tab
 * makes more calls than one second's budget, so it is lifted, as tree-rig.ts lifts it.
 */
const POLICY: { serverCallsPerSecond: number; memoryMaxPages: number; computeBudgetMs: number; hostNetTimeoutMs: number; serverNetTimeoutMs: number; portTimeoutMs: number; hostCallsPerSecond: number; maxLiveInstancesPerPage: number; maxRequestBytes: number; maxReplyBytes: number; maxLiveReplies: number; replyTtlMs: number; maxLogBytes: number; peerAuthorizationsPerSecond: number; ihttp: IhttpLimits; } = { ...STANDARD_HOST_POLICY, serverCallsPerSecond: 100_000 };
const HELD: Capability[] = ['storage.user', 'storage.node', 'storage.node.authored'];
const NODE: { id: string; name: string; parent_id: null; children: never[]; metadata: number[]; } = { id: 'n1', name: 'Platform', parent_id: null, children: [], metadata: [...new TextEncoder().encode(JSON.stringify({ time_zone: 'America/New_York' }))] };

export interface MountRig {
  readonly store: MemoryStore;
  readonly glue: GlueInstance;
  readonly change: (c: StorageChange) => void;
}

/** What a rig adds to storage: an ihttp port (a relay's) and the grants that use it. */
export interface RigExtra {
  readonly ihttp: IhttpPort;
  readonly held: readonly Capability[];
}

export function mountRig(me: string, store: MemoryStore = new MemoryStore(me), extra: RigExtra | null = null): MountRig {
  const listeners: Set<(c: StorageChange) => void> = new Set();
  const glue: GlueInstance = glueInstance({
    appId: 'net.avarok.calendar', policy: POLICY,
    ports: extra === null ? { storage: store.port() } : { storage: store.port(), ihttp: extra.ihttp },
    held: new Set<Capability>([...HELD, ...(extra?.held ?? [])]),
    limits: { topics: null, p2p: null }, clock: new ManualClock(Date.now()), pageUrl: 'https://w.example/n1',
    storageChanges: (l) => { listeners.add(l); return () => listeners.delete(l); },
  });
  return { store, glue, change: (c: StorageChange): void => { for (const l of listeners) l(c); } };
}

/** `mayEditNode`: whether `me` holds EditMdx on n1, as the tab host reads it from the member's permissions. */
export function mountCalendar(glue: GlueInstance, me: string, mayEditNode: boolean): void {
  const state: WorkspaceState = { nodes: { n1: NODE }, members: {}, workspace: { metadata: [] } } as unknown as WorkspaceState;
  render(
    <WorkspaceContext.Provider value={{ state }}>
      <CalendarMount glue={glue} install={{} as AppInstall} manifest={{ name: 'Calendar' } as AppManifest} nodeId="n1" me={me} tabId="calendar" mayEditNode={mayEditNode} />
    </WorkspaceContext.Provider>,
  );
}
