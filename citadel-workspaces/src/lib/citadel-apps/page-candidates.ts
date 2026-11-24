/**
 * Which installs a new node's page may be (node-page-abi.md §1, §3): one whose release offers
 * `node_page`, runs on the Citadel App ABI, is Active, and whose install scope reaches everyone
 * who will open the new node, so the page never reads "not available" to some of its own readers.
 * A child of `parentId` is reached by a Workspace install and by a NodeTree install rooted at the
 * parent or one of its ancestors; a Node install reaches only its own node, and a Users or
 * SelfOnly install reaches some people, never a node. Pure: the installs and listings are inputs.
 */
import type { AppInstall, InstallScope, ScopeKind } from 'citadel-workspace-client-ts';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import { mountFor } from './first-party/registry';
import type { ListedApp } from './listing-model';
import { NODE_REACHING_SCOPES } from './manifest/manifest-shape';
import { refusalCopy } from './refusal-copy';
import { runsOn } from './runtime/placement';

export interface PageCandidate {
  readonly install: AppInstall;
  readonly app: ListedApp;
}

/** The installs that may be a page here: still being read, unreadable (why), or the list. */
export type PageCandidates = { kind: 'loading' } | { kind: 'failed'; why: string } | { kind: 'ready'; candidates: readonly PageCandidate[] };

/** Where the installs and each app's listing are read from (zone-data.ts's port, in production). */
export interface CandidateSource {
  installs: () => Promise<AppsResult<AppInstall[]>>;
  listing: (appId: string) => Promise<AppsResult<ListedApp>>;
}

/** Whether an install's scope reaches every reader of a new child of `parentId` (`ancestors`: the parent's, nearest first). */
export function reachesNewChild(scope: InstallScope, parentId: string, ancestors: readonly string[]): boolean {
  if (scope === 'Workspace') return true;
  return 'NodeTree' in scope && (scope.NodeTree === parentId || ancestors.includes(scope.NodeTree));
}

const offersPage = (app: ListedApp): boolean =>
  runsOn(app.manifest, 'page')
  && app.manifest.scopes.some((s: ScopeKind): boolean => NODE_REACHING_SCOPES.includes(s))
  && mountFor(app.manifest.sdk.abi) === 'worker';

/** The installs a new child of `parentId` may open as its page, in the order the kernel listed them. */
export function pageCandidates(
  installs: readonly AppInstall[],
  listings: ReadonlyMap<string, ListedApp>,
  parentId: string,
  ancestors: readonly string[],
): PageCandidate[] {
  return installs.flatMap((install: AppInstall): PageCandidate[] => {
    const app: ListedApp | undefined = listings.get(install.app_id);
    const fits: boolean = app !== undefined && install.state === 'Active' && reachesNewChild(install.scope, parentId, ancestors) && offersPage(app);
    return fits && app !== undefined ? [{ install, app }] : [];
  });
}

/** Read the installs, then the listing of each app that might fit; an app whose listing is refused is not a candidate. */
export async function loadPageCandidates(source: CandidateSource, parentId: string, ancestors: readonly string[]): Promise<PageCandidates> {
  const installs: AppsResult<AppInstall[]> = await source.installs();
  if (!installs.ok) return { kind: 'failed', why: refusalCopy(installs.refusal) };
  const reaching: AppInstall[] = installs.value.filter((i: AppInstall): boolean => i.state === 'Active' && reachesNewChild(i.scope, parentId, ancestors));
  const ids: string[] = [...new Set(reaching.map((i: AppInstall): string => i.app_id))];
  const read: [string, AppsResult<ListedApp>][] = await Promise.all(ids.map(async (id: string): Promise<[string, AppsResult<ListedApp>]> => [id, await source.listing(id)]));
  const listings: Map<string, ListedApp> = new Map(read.flatMap(([id, r]: [string, AppsResult<ListedApp>]): [string, ListedApp][] => (r.ok ? [[id, r.value]] : [])));
  return { kind: 'ready', candidates: pageCandidates(reaching, listings, parentId, ancestors) };
}
