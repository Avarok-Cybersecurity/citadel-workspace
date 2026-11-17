/**
 * The marketplace opened from a node's "+" (design 2.5): the apps that can be a tab on this node,
 * in the order someone adding one most likely wants. Pure.
 *
 * An app can be a tab when its manifest lists `node_tab` and a scope whose install everyone on a
 * node sees (`workspace`, `node`, `node_tree`), and it is not a tab here already. The order is
 * stable: installed and covering this person here, installed elsewhere, not installed; then
 * first-party publishers; then planning, productivity and communication apps; then by name.
 */
import type { AppCategory, AppInstall, AppManifest, ScopeKind } from 'citadel-workspace-client-ts';
import type { ListedApp } from './listing-model';
import { NODE_REACHING_SCOPES } from './manifest/manifest-shape';
import { covers } from './install-covers';
import { isFirstPartyKey } from './first-party/publisher-keys';

/** Where this person is adding a tab, and what is already there. */
export interface TabReach {
  me: string;
  nodeId: string;
  /** The node's ancestors, nearest first. */
  ancestors: readonly string[];
  installs: readonly AppInstall[];
  /** The node's app tabs now. */
  tabs: readonly string[];
}

export type TabStanding = 'covering' | 'elsewhere' | 'not-installed';

const LEADING_CATEGORIES: readonly AppCategory[] = ['planning', 'productivity', 'communication'];

export function canBeATab(m: Pick<AppManifest, 'surfaces' | 'scopes'>): boolean {
  return m.surfaces.includes('node_tab') && m.scopes.some((s: ScopeKind): boolean => NODE_REACHING_SCOPES.includes(s));
}

export function tabStanding(appId: string, r: TabReach): TabStanding {
  const mine: AppInstall[] = r.installs.filter((i: AppInstall): boolean => i.app_id === appId);
  if (mine.length === 0) return 'not-installed';
  return mine.some((i: AppInstall): boolean => covers(i.scope, r.me, r.nodeId, r.ancestors)) ? 'covering' : 'elsewhere';
}

const STANDING_RANK: Readonly<Record<TabStanding, number>> = { covering: 0, elsewhere: 1, 'not-installed': 2 };

function rankOf(app: ListedApp, r: TabReach): number[] {
  const m: AppManifest = app.manifest;
  return [
    STANDING_RANK[tabStanding(m.id, r)],
    isFirstPartyKey(m.publisher.mldsa65_public_key) ? 0 : 1,
    m.categories.some((c: AppCategory): boolean => LEADING_CATEGORIES.includes(c)) ? 0 : 1,
  ];
}

function byRank(a: readonly number[], b: readonly number[]): number {
  for (let i: number = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function appsForTab(apps: readonly ListedApp[], r: TabReach): ListedApp[] {
  const offered: ListedApp[] = apps.filter((app: ListedApp): boolean => canBeATab(app.manifest) && !r.tabs.includes(app.manifest.id));
  const ranked: { app: ListedApp; rank: number[] }[] = offered.map((app: ListedApp): { app: ListedApp; rank: number[] } => ({ app, rank: rankOf(app, r) }));
  ranked.sort((a: { app: ListedApp; rank: number[] }, b: { app: ListedApp; rank: number[] }): number => byRank(a.rank, b.rank) || a.app.manifest.name.localeCompare(b.app.manifest.name));
  return ranked.map((x: { app: ListedApp }): ListedApp => x.app);
}
