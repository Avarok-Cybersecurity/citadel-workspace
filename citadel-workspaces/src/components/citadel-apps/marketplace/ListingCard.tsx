/**
 * One app in a list: icon, name, summary, publisher and categories, every one a text node (the
 * listing is the publisher's words, never markup). The card is one 44px+ button that opens the
 * listing; in the tab view ("+" on a node) a second button below it adds the app as a tab, or
 * installs it and then adds it.
 */
import type { AppInstall } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import type { ListedApp } from '@/lib/citadel-apps/listing-model';
import { AppIconImage } from './AppIconImage';

/** The tab view's action on one card. */
export interface TabAction {
  label: 'Add as a tab' | 'Install and add';
  run: () => void;
  busy: boolean;
}

interface ListingCardProps {
  app: ListedApp;
  installed: AppInstall | null;
  onOpen: (app: ListedApp) => void;
  tab: TabAction | null;
}

export function ListingCard({ app, installed, onOpen, tab }: ListingCardProps): JSX.Element {
  const m: ListedApp['manifest'] = app.manifest;
  return (
    <li className="flex flex-col rounded-lg border border-border bg-card" data-testid="apps-listing" data-app-id={m.id}>
      <button
        type="button"
        onClick={() => onOpen(app)}
        data-testid="apps-listing-card"
        data-app-id={m.id}
        className="flex min-h-[80px] w-full items-start gap-[12px] rounded-lg p-[12px] text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AppIconImage icon={m.icon} size={40} />
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="flex flex-wrap items-baseline gap-x-[8px]">
            <span className="break-words font-medium text-foreground">{m.name}</span>
            <span className="text-xs text-muted-foreground">{m.version}</span>
            {installed !== null && <span className="text-xs font-medium text-success-emphasis" data-testid="apps-listing-installed">Installed</span>}
            {m.surfaces.includes('node_tab') && <span className="rounded-sm border border-border px-[6px] text-xs text-muted-foreground" data-testid="apps-listing-tab-badge">Tab</span>}
          </span>
          <span className="break-words text-sm text-foreground/80">{m.summary}</span>
          <span className="break-words text-xs text-muted-foreground">
            {m.publisher.name} · {m.categories.join(', ')}
          </span>
        </span>
      </button>
      {tab !== null && (
        <div className="px-[12px] pb-[12px] pl-[64px]">
          <Button variant={tab.label === 'Add as a tab' ? 'default' : 'outline'} className="min-h-[44px]" disabled={tab.busy} onClick={tab.run} data-testid="apps-listing-tab-action">{tab.label}</Button>
        </div>
      )}
    </li>
  );
}
