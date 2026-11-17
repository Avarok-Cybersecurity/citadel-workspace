/**
 * Binds a first-party glue app's ports for one tab (runtime/glue-steps.ts) while the tab is shown,
 * and lets them go when it is not: the glue analogue of `useRuntimeMount`. Its first-party ports
 * read the tree and the roster as they are at the time of each call, not as they were at mount.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { pageAppNotices } from '@/lib/citadel-apps/app-notices';
import type { RosterMember } from '@/lib/citadel-apps/runtime/first-party-ports';
import type { TreeNode } from '@/lib/citadel-apps/runtime/nodes-port';
import type { AppTabMount, AppZoneRuntime, GlueBound, GlueHandle } from './app-zone-environment';

export type GlueBinding = { kind: 'binding' } | GlueBound;

export function useGlueBinding(runtime: AppZoneRuntime, tab: AppTabMount): GlueBinding {
  const { state } = useWorkspace();
  const tree: MutableRefObject<Readonly<Record<string, TreeNode>>> = useRef<Readonly<Record<string, TreeNode>>>(state.nodes);
  const roster: MutableRefObject<readonly RosterMember[]> = useRef<readonly RosterMember[]>(Object.values(state.members));
  tree.current = state.nodes;
  roster.current = Object.values(state.members);
  const [binding, setBinding] = useState<GlueBinding>({ kind: 'binding' });
  const { install, manifest, tabId, nodeId, me } = tab;
  useEffect(() => {
    let live: boolean = true;
    setBinding({ kind: 'binding' });
    const handle: GlueHandle = runtime.bindGlue({
      install, manifest, tabId, nodeId, me,
      firstParty: { tree: () => tree.current, roster: () => roster.current, notices: pageAppNotices },
    });
    void handle.ready.then((bound: GlueBound): void => { if (live) setBinding(bound); });
    return (): void => {
      live = false;
      void handle.close();
    };
  }, [runtime, install, manifest, tabId, nodeId, me]);
  return binding;
}
