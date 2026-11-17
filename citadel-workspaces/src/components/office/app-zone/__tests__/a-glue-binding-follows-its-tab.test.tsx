/**
 * A glue tab's binding as the pane holds it (use-glue-binding.ts): it reads `binding` until the
 * runtime has bound the ports, then the bound instance; the first-party ports it binds read the
 * tree as it is at each call, not as it was at mount; and it lets the binding go when the tab
 * unmounts or moves to another node, binding afresh for the new one.
 *
 * The runtime is a recording double: what binding does is proven over the real runtime in
 * a-glue-tab-binds-first-party-ports.test.ts; this test is about when the hook binds and closes.
 */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { AppInstall, AppManifest } from 'citadel-workspace-client-ts';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import type { GlueInstance } from '@/lib/citadel-apps/host/glue-instance';
import type { AppTabMount, AppZoneRuntime, GlueBound, GlueTabMount } from '../app-zone-environment';
import { useGlueBinding } from '../use-glue-binding';

interface Bind { tab: GlueTabMount; bound: (b: GlueBound) => void; closed: boolean }

function recordingRuntime(): { runtime: AppZoneRuntime; binds: Bind[] } {
  const binds: Bind[] = [];
  const unused = (): never => { throw new Error('a glue tab draws nothing'); };
  const runtime: AppZoneRuntime = {
    mount: unused, mountPane: unused,
    bindGlue: (tab: GlueTabMount) => {
      let bound: (b: GlueBound) => void = () => {};
      const ready: Promise<GlueBound> = new Promise<GlueBound>((r) => { bound = r; });
      const bind: Bind = { tab, bound: (b) => bound(b), closed: false };
      binds.push(bind);
      return { ready, close: async (): Promise<void> => { bind.closed = true; } };
    },
  };
  return { runtime, binds };
}

const stateWith = (name: string): WorkspaceState => ({ nodes: { n1: { id: 'n1', name, parent_id: null, children: [] } }, members: {} }) as unknown as WorkspaceState;
/** One install and manifest, as the pane's view holds them: a new object would be a new tab to bind. */
const INSTALL: AppInstall = { id: 'i1' } as AppInstall;
const MANIFEST: AppManifest = { name: 'Calendar' } as AppManifest;
const tabOn = (nodeId: string): AppTabMount => ({ install: INSTALL, manifest: MANIFEST, tabId: 'calendar', nodeId, me: 'amy' });

describe("a glue tab's binding", () => {
  it('reads binding, then the bound instance, and its tree port reads the tree as it is now', async () => {
    const { runtime, binds } = recordingRuntime();
    let state: WorkspaceState = stateWith('Platform');
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => <WorkspaceProvider state={state}>{children}</WorkspaceProvider>;
    const tab: AppTabMount = tabOn('n1');
    const { result, rerender } = renderHook(() => useGlueBinding(runtime, tab), { wrapper });
    expect(result.current).toEqual({ kind: 'binding' });
    const instance: GlueInstance = { held: new Set() } as unknown as GlueInstance;
    await act(async () => { binds[0]?.bound({ kind: 'bound', instance }); });
    expect(result.current).toEqual({ kind: 'bound', instance });
    state = stateWith('Platform team');
    rerender();
    expect(binds).toHaveLength(1);
    expect(binds[0]?.tab.firstParty.tree().n1?.name).toBe('Platform team');
  });

  it('lets the binding go on unmount, and on a move to another node binds afresh', () => {
    const { runtime, binds } = recordingRuntime();
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => <WorkspaceProvider state={stateWith('Platform')}>{children}</WorkspaceProvider>;
    const { rerender, unmount } = renderHook(({ node }: { node: string }) => useGlueBinding(runtime, tabOn(node)), { wrapper, initialProps: { node: 'n1' } });
    rerender({ node: 'n2' });
    expect(binds.map((b) => [b.tab.nodeId, b.closed])).toEqual([['n1', true], ['n2', false]]);
    unmount();
    expect(binds[1]?.closed).toBe(true);
  });
});
