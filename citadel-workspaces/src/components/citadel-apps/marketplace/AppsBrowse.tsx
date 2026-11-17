/**
 * One tab's listings with a search over name, summary and categories, and the states around them:
 * loading, nothing listed, nothing found, and a source that could not be read. Opened from a
 * node's "+", it lists only the apps that can be a tab there, most likely first
 * (listing-for-tab.ts), each with its way to become one.
 */
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { AppInstall } from 'citadel-workspace-client-ts';
import { searchApps, type ListedApp, type ListingOrigin } from '@/lib/citadel-apps/listing-model';
import { appsForTab, tabStanding, type TabReach } from '@/lib/citadel-apps/listing-for-tab';
import { refusalCopy } from '@/lib/citadel-apps/refusal-copy';
import { ListingCard, type TabAction } from './ListingCard';
import type { MarketplaceData } from './use-marketplace-data';

/** The tab view: where the tab goes, and what its two actions do. */
export interface TabBrowse {
  reach: TabReach;
  nodeName: string | null;
  /** An app is being added; its card's action waits. */
  adding: string | null;
  add: (app: ListedApp) => void;
  installAndAdd: (app: ListedApp) => void;
}

interface AppsBrowseProps {
  data: MarketplaceData;
  origin: ListingOrigin;
  onOpen: (app: ListedApp) => void;
  tab: TabBrowse | null;
}

function actionFor(app: ListedApp, tab: TabBrowse): TabAction {
  const covering: boolean = tabStanding(app.manifest.id, tab.reach) === 'covering';
  return {
    label: covering ? 'Add as a tab' : 'Install and add',
    run: (): void => (covering ? tab.add(app) : tab.installAndAdd(app)),
    busy: tab.adding !== null,
  };
}

function emptyCopy(origin: ListingOrigin, tab: TabBrowse | null): string {
  if (tab !== null) return origin === 'global' ? 'Nothing in the global catalogue can be a tab here yet.' : 'Nothing published to this workspace can be a tab here yet.';
  return origin === 'global' ? 'No apps are in the global catalogue yet.' : 'No apps have been published to this workspace yet.';
}

export function AppsBrowse({ data, origin, onOpen, tab }: AppsBrowseProps): JSX.Element {
  const [query, setQuery] = useState<string>('');
  const fromOrigin: ListedApp[] = data.apps.filter((a: ListedApp) => a.origin === origin);
  const listed: ListedApp[] = tab === null ? fromOrigin : appsForTab(fromOrigin, tab.reach);
  const found: ListedApp[] = searchApps(listed, query);
  const problem: string | null = origin === 'global'
    ? (data.globalProblem === null ? null : 'The global catalogue could not be loaded.')
    : (data.serverProblem === null ? null : refusalCopy(data.serverProblem));
  const installedOf = (id: string): AppInstall | null => data.installs.find((i: AppInstall) => i.app_id === id) ?? null;

  return (
    <div className="flex flex-col gap-[12px]" data-testid={`apps-browse-${origin}`}>
      {tab !== null && (
        <h3 className="break-words text-sm font-medium text-foreground" data-testid="apps-browse-for-tab">
          Apps that can be a tab on {tab.nodeName === null ? 'this page' : `“${tab.nodeName}”`}
        </h3>
      )}
      <Input
        type="search"
        value={query}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        placeholder="Search apps"
        aria-label="Search apps"
        className="min-h-[44px]"
        data-testid="apps-search"
      />
      {problem !== null && <p role="alert" className="text-sm text-destructive-emphasis" data-testid="apps-browse-problem">{problem}</p>}
      {data.loading ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="apps-browse-loading">Loading apps…</p>
      ) : listed.length === 0 ? (
        <p className="py-[12px] text-sm text-muted-foreground" data-testid="apps-browse-empty">{emptyCopy(origin, tab)}</p>
      ) : found.length === 0 ? (
        <p className="py-[12px] text-sm text-muted-foreground" data-testid="apps-browse-none-found">No apps match “{query}”.</p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {found.map((app: ListedApp) => (
            <ListingCard key={`${app.origin}:${app.manifest.id}`} app={app} installed={installedOf(app.manifest.id)} onOpen={onOpen} tab={tab === null ? null : actionFor(app, tab)} />
          ))}
        </ul>
      )}
    </div>
  );
}
