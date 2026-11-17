/**
 * The tab view's list (listing-for-tab.ts): what can be a tab on a node, and in what order.
 */
import { describe, expect, it } from 'vitest';
import type { AppInstall, AppListing } from 'citadel-workspace-client-ts';
import { listedApps, type ListedApp } from '../listing-model';
import { appsForTab, canBeATab, tabStanding, type TabReach } from '../listing-for-tab';
import { installOf, listingOf, type ManifestChanges } from '@/test/app-manifests';

const app = (c: ManifestChanges): ListedApp => listedApps([listingOf({ surfaces: ['node_tab'], ...c }) as AppListing])[0];
const reach = (installs: AppInstall[], tabs: string[] = []): TabReach => ({ me: 'alice', nodeId: 'n-2', ancestors: ['n-1', 'root'], installs, tabs });
const ids = (apps: readonly ListedApp[]): string[] => apps.map((a: ListedApp): string => a.manifest.id);

describe('which apps can be a tab', () => {
  it('needs node_tab and a scope everyone on a node sees (control: either missing, it cannot)', () => {
    expect(canBeATab({ surfaces: ['node_tab'], scopes: ['node_tree'] })).toBe(true);
    expect(canBeATab({ surfaces: ['md_zone'], scopes: ['workspace'] })).toBe(false);
    expect(canBeATab({ surfaces: ['node_tab'], scopes: ['self', 'users'] })).toBe(false);
  });

  it('a md_zone-only app is left out, and so is one already a tab here (control: the rest stay)', () => {
    const apps: ListedApp[] = [app({ id: 'com.acme.chart', name: 'Chart', surfaces: ['md_zone'] }), app({ id: 'com.acme.board', name: 'Board' }), app({ id: 'com.acme.cards', name: 'Cards' })];
    expect(ids(appsForTab(apps, reach([], ['com.acme.cards'])))).toEqual(['com.acme.board']);
  });

  it('orders installed here, installed elsewhere, the rest; then planning, productivity and communication; then name', () => {
    const apps: ListedApp[] = [
      app({ id: 'com.acme.zeta', name: 'Zeta', categories: ['utilities'] }),
      app({ id: 'com.acme.alpha', name: 'Alpha', categories: ['utilities'] }),
      app({ id: 'com.acme.plan', name: 'Plan', categories: ['planning'] }),
      app({ id: 'com.acme.away', name: 'Away', categories: ['utilities'] }),
      app({ id: 'com.acme.here', name: 'Here', categories: ['utilities'] }),
    ];
    const installs: AppInstall[] = [installOf('com.acme.here', { NodeTree: 'n-1' }), installOf('com.acme.away', { Node: 'n-9' })];
    expect(ids(appsForTab(apps, reach(installs)))).toEqual(['com.acme.here', 'com.acme.away', 'com.acme.plan', 'com.acme.alpha', 'com.acme.zeta']);
    expect([tabStanding('com.acme.here', reach(installs)), tabStanding('com.acme.away', reach(installs)), tabStanding('com.acme.plan', reach(installs))]).toEqual(['covering', 'elsewhere', 'not-installed']);
  });
});
