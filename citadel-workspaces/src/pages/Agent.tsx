/**
 * /agent: About, Updates and Apps for the Citadel Agent, one page for everything that opens it
 * (the menu-bar and tray items link to /agent#about and /agent#updates). The hash picks the tab, so a
 * deep link lands where it says and the Back button walks the tabs.
 */
import { Link, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { CitadelLogo } from '@/components/brand/CitadelLogo';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentAboutTab } from '@/components/agent-update/AgentAboutTab';
import { AgentUpdatesTab } from '@/components/agent-update/AgentUpdatesTab';
import { AgentAppsTab } from '@/components/agent-apps/AgentAppsTab';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { LookingForAgent, NoAgent } from '@/components/agent-update/NoAgent';
import { useRestartToUpdate, type RestartControl } from '@/components/agent-update/use-restart-to-update';
import { useUpdater, type Updater } from '@/components/agent-update/use-updater';

export type AgentTab = 'about' | 'updates' | 'apps';

/** `#updates` and `#apps` are their tabs; anything else, including no hash, is About. */
export function tabFromHash(hash: string): AgentTab {
  if (hash === '#updates') return 'updates';
  return hash === '#apps' ? 'apps' : 'about';
}

function TabBody({ tab, updater, restart, open }: { tab: AgentTab; updater: Updater; restart: RestartControl; open: (t: AgentTab) => void }): JSX.Element {
  if (updater.presence === 'loading') return <LookingForAgent />;
  if (updater.presence === 'absent') return <NoAgent />;
  if (tab === 'apps') return <AgentAppsTab resolveCid={getCurrentCid} />;
  return tab === 'about'
    ? <AgentAboutTab updater={updater} restart={restart} onOpenUpdates={(): void => open('updates')} />
    : <AgentUpdatesTab updater={updater} restart={restart} />;
}

export default function Agent(): JSX.Element {
  const { hash } = useLocation();
  const navigate: NavigateFunction = useNavigate();
  const updater: Updater = useUpdater();
  const restart: RestartControl = useRestartToUpdate();
  const tab: AgentTab = tabFromHash(hash);
  const open = (next: AgentTab): void => { navigate({ hash: `#${next}` }, { replace: true }); };
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <CitadelLogo variant="horizontal" height={30} />
          <Link to="/" className="tap-target rounded-md px-1 text-sm text-primary-accent underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Back to Citadel
          </Link>
        </header>
        <h1 className="mb-4 text-2xl font-semibold">Citadel Agent</h1>
        <Tabs value={tab} onValueChange={(value: string): void => open(tabFromHash(`#${value}`))}>
          <TabsList className="mb-4 grid h-auto w-full grid-cols-3 sm:inline-flex sm:w-auto" aria-label="Citadel Agent">
            <TabsTrigger value="about" data-testid="agent-tab-about">About</TabsTrigger>
            <TabsTrigger value="updates" data-testid="agent-tab-updates">Updates</TabsTrigger>
            <TabsTrigger value="apps" data-testid="agent-tab-apps">Apps</TabsTrigger>
          </TabsList>
          <TabsContent value="about" className="mt-0"><TabBody tab="about" updater={updater} restart={restart} open={open} /></TabsContent>
          <TabsContent value="updates" className="mt-0"><TabBody tab="updates" updater={updater} restart={restart} open={open} /></TabsContent>
          <TabsContent value="apps" className="mt-0"><TabBody tab="apps" updater={updater} restart={restart} open={open} /></TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
