/**
 * The marketplace (design 2.7): the global catalogue, this workspace's apps, what is installed
 * for you and, for those who manage apps, install requests. A listing opens its install flow.
 * Lazy (LazyAppsModal.tsx): none of this is on the landing page's critical path.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Permission } from '@/lib/permissions-service/types';
import type { AppsModalRequest, TabTarget } from '@/lib/citadel-apps/apps-modal-store';
import type { ListedApp } from '@/lib/citadel-apps/listing-model';
import { NOT_AVAILABLE_COPY } from '@/lib/citadel-apps/refusal-copy';
import { useMarketplaceData, type MarketplaceData } from './use-marketplace-data';
import { useLinkedApp, type LinkedApp } from './use-linked-app';
import { AppsBrowse, type TabBrowse } from './AppsBrowse';
import { AppFlow } from './AppFlow';
import { InstalledApps } from './InstalledApps';
import type { MarketplaceDeps, MarketplaceViewer, MarketTab } from './marketplace-types';

export interface AppsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: AppsModalRequest;
  deps: MarketplaceDeps;
  viewer: MarketplaceViewer;
}

const TRIGGER: string = 'min-h-[44px] text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground';

export function AppsModal({ open, onOpenChange, request, deps, viewer }: AppsModalProps): JSX.Element {
  const data: MarketplaceData = useMarketplaceData(deps);
  const [tab, setTab] = useState<MarketTab>('global');
  const [opened, setOpened] = useState<ListedApp | null>(null);
  const [linkDismissed, setLinkDismissed] = useState<boolean>(false);
  const linkedId: string | null = request.kind === 'link' && !linkDismissed ? request.link.appId : null;
  const linked: LinkedApp = useLinkedApp(linkedId, data, deps);
  const manages: boolean = viewer.authority.holds(Permission.AppManage, viewer.rootId) === 'yes';
  const showing: ListedApp | null = opened ?? (linked.kind === 'found' ? linked.app : null);
  const back = (): void => { setOpened(null); setLinkDismissed(true); };
  const target: TabTarget | null = request.kind === 'tab' ? request.target : null;
  const linkNode: string | null = request.kind === 'link' ? request.link.nodeId : null;
  const flowViewer: MarketplaceViewer = target !== null ? { ...viewer, nodeId: target.nodeId } : linkNode !== null ? { ...viewer, nodeId: linkNode } : viewer;
  const [adding, setAdding] = useState<string | null>(null);
  const addTab = async (app: ListedApp): Promise<void> => {
    if (target === null) return;
    setAdding(app.manifest.id);
    // A refused add is shown by the node pane's own write (use-node-tabs.ts); the list stays open.
    const added: boolean = await target.add(app.manifest.id);
    setAdding(null);
    if (added) onOpenChange(false);
  };
  const tabBrowse: TabBrowse | null = target === null ? null : {
    reach: { me: viewer.me, nodeId: target.nodeId, ancestors: viewer.ancestors(target.nodeId), installs: data.installs, tabs: target.tabs },
    nodeName: viewer.nodeName(target.nodeId), adding, add: (app: ListedApp): void => { void addTab(app); }, installAndAdd: setOpened,
  };

  let body: JSX.Element;
  if (showing !== null) {
    body = (
      <div className="flex flex-col gap-[12px]">
        <Button variant="ghost" className="min-h-[44px] self-start" onClick={back} data-testid="apps-back-to-list">← All apps</Button>
        <AppFlow
          key={showing.manifest.id} app={showing} installs={data.installs} deps={deps} viewer={flowViewer} onInstalled={data.recordInstall}
          onDone={target === null ? back : (): void => onOpenChange(false)} forTab={target === null ? null : { add: target.add }}
        />
      </div>
    );
  } else if (linked.kind === 'unavailable' || linked.kind === 'looking') {
    body = (
      <div className="flex flex-col gap-[12px] py-[12px]" data-testid={`apps-link-${linked.kind}`}>
        <p role={linked.kind === 'unavailable' ? 'alert' : 'status'} className="text-foreground">{linked.kind === 'unavailable' ? NOT_AVAILABLE_COPY : 'Looking for the app…'}</p>
        <Button variant="outline" className="min-h-[44px] self-start" onClick={back}>See all apps</Button>
      </div>
    );
  } else {
    body = (
      <Tabs value={tab} onValueChange={(v: string) => setTab(v as MarketTab)} className="flex flex-col gap-[12px]">
        <TabsList className={`grid w-full ${manages ? 'grid-cols-4' : 'grid-cols-3'} h-auto`}>
          <TabsTrigger value="global" className={TRIGGER} data-testid="apps-tab-global">Global</TabsTrigger>
          <TabsTrigger value="workspace" className={TRIGGER} data-testid="apps-tab-workspace">This workspace</TabsTrigger>
          <TabsTrigger value="installed" className={TRIGGER} data-testid="apps-tab-installed">Installed</TabsTrigger>
          {manages && <TabsTrigger value="requests" className={TRIGGER} data-testid="apps-tab-requests">Requests</TabsTrigger>}
        </TabsList>
        <TabsContent value="global"><AppsBrowse data={data} origin="global" onOpen={setOpened} tab={tabBrowse} /></TabsContent>
        <TabsContent value="workspace"><AppsBrowse data={data} origin="workspace" onOpen={setOpened} tab={tabBrowse} /></TabsContent>
        <TabsContent value="installed">
          <InstalledApps installs={data.installs} apps={data.apps} deps={deps} viewer={viewer} onChanged={data.recordInstall} onRemoved={data.forgetInstall} />
        </TabsContent>
        {manages && (
          <TabsContent value="requests">
            <p className="py-[32px] text-sm text-muted-foreground" data-testid="apps-requests-empty">No requests yet. When someone asks for an app on a page, it appears here.</p>
          </TabsContent>
        )}
      </Tabs>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-[640px] flex-col gap-[12px] overflow-y-auto" data-testid="apps-modal">
        <DialogHeader>
          <DialogTitle>Apps</DialogTitle>
          <DialogDescription>Apps can do only what you allow when you install them.</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
