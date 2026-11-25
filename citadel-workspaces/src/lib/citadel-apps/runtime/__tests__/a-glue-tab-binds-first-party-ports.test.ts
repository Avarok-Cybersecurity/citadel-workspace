/**
 * A first-party glue tab's binding (glue-steps.ts `bindGlue`, through the page's runtime): it is
 * given the tree and the roster as they are at each call, and its notifications are badged with
 * the app's name and the tab's node and handed to the page's sink; it takes one of the page's instance slots and
 * gives it back on close, so a second tab binds once the first is closed; and a page with no slot
 * left, or a manifest that does not run in a tab, binds nothing and says why. Its date is the page's
 * wall clock (the world's `nowMs`), never the monotonic dispatch clock it waits on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlueBound, GlueHandle, GlueTabMount } from '@/components/office/app-zone/app-zone-environment';
import { calendarPorts, type CalendarPorts } from '@/lib/calendar/ports';
import { InstanceSlots } from '../../host/instance-slots';
import { appModule } from '../../host/__tests__/app-fixtures';
import type { RosterMember } from '../first-party-ports';
import type { PageNode } from '../nodes-port';
import { FakeRuntimeKernel, release, rig, tabOf, type Rig } from './runtime-rig';
import type { ManifestChanges } from '@/test/app-manifests';

let rigs: Rig[] = [];
afterEach(() => { rigs.forEach((r: Rig) => r.close()); rigs = []; });

const TAB_APP: ManifestChanges = { surfaces: ['node_tab'] };

function glueTab(kernel: FakeRuntimeKernel, tree: () => Record<string, PageNode>): GlueTabMount {
  return { ...tabOf(kernel.rel), firstParty: { tree, roster: (): RosterMember[] => [] } };
}

describe('a glue tab binding', () => {
  it("reads the tree as it is at each call and badges its notifications with the app's name", async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), ['nodes.read', 'notifications'], TAB_APP));
    const r: Rig = rig(kernel);
    rigs.push(r);
    let tree: Record<string, PageNode> = { 'n-1': { id: 'n-1', name: 'Platform', parent_id: null, children: [] } };
    const bound: GlueBound = await r.runtime.bindGlue(glueTab(kernel, () => tree)).ready;
    if (bound.kind !== 'bound') throw new Error(bound.why);
    const ports: CalendarPorts = calendarPorts(bound.instance);
    expect((await ports.node('n-1')).name).toBe('Platform');
    tree = { 'n-1': { id: 'n-1', name: 'Platform team', parent_id: null, children: [] } };
    expect((await ports.node('n-1')).name).toBe('Platform team');
    await ports.notify('bookings', 'New booking', 'Intro with ana');
    expect(r.notices).toEqual([{ appId: kernel.rel.install.app_id, from: 'Kanban', nodeId: 'n-1', title: 'New booking', body: 'Intro with ana' }]);
  });

  it("dates by the page's wall clock, not the dispatch clock it waits on", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T15:00:00Z'));
    try {
      const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), [], TAB_APP));
      const r: Rig = rig(kernel);
      rigs.push(r);
      const bound: GlueBound = await r.runtime.bindGlue(glueTab(kernel, () => ({}))).ready;
      if (bound.kind !== 'bound') throw new Error(bound.why);
      expect(bound.instance.wallNow()).toBe(Date.parse('2026-11-25T15:00:00Z'));
      expect(calendarPorts(bound.instance).clock.now()).toBe(Date.parse('2026-11-25T15:00:00Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes one of the page's slots and gives it back on close; with none left it binds nothing", async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), [], TAB_APP));
    const r: Rig = rig(kernel, { slots: new InstanceSlots(1) });
    rigs.push(r);
    const tab: GlueTabMount = glueTab(kernel, () => ({}));
    const first: GlueHandle = r.runtime.bindGlue(tab);
    expect((await first.ready).kind).toBe('bound');
    expect(await r.runtime.bindGlue(tab).ready).toEqual({ kind: 'stopped', why: 'This page is already running as many apps as it can, so Kanban was not started.' });
    await first.close();
    expect((await r.runtime.bindGlue(tab).ready).kind).toBe('bound');
  });

  it('binds nothing for a manifest that does not run in a tab', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), []));
    const r: Rig = rig(kernel);
    rigs.push(r);
    expect(await r.runtime.bindGlue(glueTab(kernel, () => ({}))).ready).toEqual({ kind: 'stopped', why: 'Kanban cannot run in a tab, so it was not started.' });
  });
});
