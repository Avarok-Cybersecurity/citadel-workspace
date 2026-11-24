/**
 * Which stored app tabs a node shows: those an install of their app reaches this person on this
 * node; all of them while the installs are not known. The stored list itself is not changed.
 */
import { describe, expect, it } from 'vitest';
import type { AppInstall } from 'citadel-workspace-client-ts';
import { installOf } from '@/test/app-manifests';
import { deriveTabList, type NodeTab } from '../tab-list';
import { INSTALLS_UNKNOWN, shownTabs, type InstallsHere } from '../installed-tabs';

const LIST: readonly NodeTab[] = deriveTabList({
  chatEnabled: true,
  node: { kind: 'absent' },
  workspace: { kind: 'list', appIds: ['net.avarok.calendar', 'com.acme.kanban'] },
}).tabs;
const keys = (tabs: readonly NodeTab[]): string[] => tabs.map((t: NodeTab): string => t.key);
const here = (installs: readonly AppInstall[]): InstallsHere => ({ kind: 'known', installs, me: 'alice', nodeId: 'room', ancestors: ['office'] });

describe('the app tabs a node shows', () => {
  it('every stored tab while the installs are not known', () => {
    expect(keys(shownTabs(LIST, INSTALLS_UNKNOWN))).toEqual(['content', 'chat', 'app:net.avarok.calendar', 'app:com.acme.kanban']);
  });

  it('an app tab whose app is installed for the workspace, or on an ancestor\'s tree, and not one uninstalled', () => {
    const installs: AppInstall[] = [installOf('net.avarok.calendar', 'Workspace'), installOf('com.acme.kanban', { NodeTree: 'office' })];
    expect(keys(shownTabs(LIST, here(installs)))).toEqual(['content', 'chat', 'app:net.avarok.calendar', 'app:com.acme.kanban']);
    expect(keys(shownTabs(LIST, here([installs[1]])))).toEqual(['content', 'chat', 'app:com.acme.kanban']);
    expect(keys(shownTabs(LIST, here([])))).toEqual(['content', 'chat']);
  });

  it('not one installed only where this person is not', () => {
    const elsewhere: AppInstall[] = [installOf('net.avarok.calendar', { SelfOnly: 'bob' }), installOf('com.acme.kanban', { Node: 'another-room' })];
    expect(keys(shownTabs(LIST, here(elsewhere)))).toEqual(['content', 'chat']);
  });
});
