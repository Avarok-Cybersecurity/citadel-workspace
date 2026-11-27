/**
 * Binds a first-party glue app's ports for one tab (runtime/glue-steps.ts) while the tab is shown,
 * and lets them go when it is not: the glue analogue of `useRuntimeMount`. Its first-party ports
 * read the tree and the roster as they are at the time of each call, not as they were at mount.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { RosterMember } from '@/lib/citadel-apps/runtime/first-party-ports';
import { withWorkspaceRoot, type PageNode } from '@/lib/citadel-apps/runtime/nodes-port';
import { useLevelName } from '@/hooks/use-level-name';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { AppTabMount, AppZoneRuntime, GlueBound, GlueHandle } from './app-zone-environment';

export type GlueBinding = { kind: 'binding' } | GlueBound;

export function useGlueBinding(runtime: AppZoneRuntime, tab: AppTabMount): GlueBinding {
  const { state } = useWorkspace();
  const workspaceName: string = useLevelName()(WORKSPACE_ROOT_ID);
  const tree: MutableRefObject<Readonly<Record<string, PageNode>>> = useRef<Readonly<Record<string, PageNode>>>(withWorkspaceRoot(state.nodes, workspaceName));
  const roster: MutableRefObject<readonly RosterMember[]> = useRef<readonly RosterMember[]>(Object.values(state.members));
  tree.current = withWorkspaceRoot(state.nodes, workspaceName);
  roster.current = Object.values(state.members);
  const [binding, setBinding] = useState<GlueBinding>({ kind: 'binding' });
  const { install, manifest, tabId, nodeId, me } = tab;
  useEffect(() => {
    let live: boolean = true;
    setBinding({ kind: 'binding' });
    const handle: GlueHandle = runtime.bindGlue({
      install, manifest, tabId, nodeId, me,
      firstParty: { tree: () => tree.current, roster: () => roster.current },
    });
    void handle.ready.then((bound: GlueBound): void => { if (live) setBinding(bound); });
    return (): void => {
      live = false;
      void handle.close();
    };
  }, [runtime, install, manifest, tabId, nodeId, me]);
  return binding;
}
