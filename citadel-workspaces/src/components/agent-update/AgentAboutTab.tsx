import { useEffect, useState, useSyncExternalStore } from 'react';
import { BookOpen, Download, ScrollText } from 'lucide-react';
import { AgentDownloadLink } from '@/components/agent-setup/AgentDownloadLink';
import { agentFacts, type AgentFacts } from '@/lib/agent-update/agent-facts';
import { osLabel } from '@/lib/agent-update/agent-os';
import { fetchDeployedEntry, buildLabel } from '@/lib/agent-update/workspace-build';
import { Button } from '@/components/ui/button';
import { AgentVersionCard } from './AgentVersionCard';
import { UpdateStatusPanel } from './UpdateStatusPanel';
import type { UpdateView } from '@/lib/agent-update/update-view';
import { useUpdateView } from './use-update-view';
import type { RestartControl } from './use-restart-to-update';
import type { Updater } from './use-updater';
import { AgentSection } from './AgentSection';

const LICENSE_URL: string = 'https://github.com/Avarok-Cybersecurity/citadel-workspace/blob/master/LICENSE';

/** Where the agent's own menu lives, by operating system: the page can only point at it. */
export function showLogsHint(os: string): string {
  const where: string = os === 'macOS' ? 'the Citadel icon in the menu bar'
    : os === 'Windows' ? 'the Citadel icon in the system tray'
      : 'the Citadel icon in the menu bar or system tray';
  return `To see the agent's logs, open ${where} and choose Show logs.`;
}

function ExternalLink({ href, children }: { href: string; children: string }): JSX.Element {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-primary-accent underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export interface AgentAboutTabProps {
  updater: Updater;
  restart: RestartControl;
  onOpenUpdates: () => void;
}

/** What is running here, whether it is current, and where to go for more. */
export function AgentAboutTab({ updater, restart, onOpenUpdates }: AgentAboutTabProps): JSX.Element | null {
  const facts: AgentFacts = useSyncExternalStore(agentFacts.subscribe, agentFacts.get);
  const view: UpdateView | null = useUpdateView(updater);
  const [build, setBuild] = useState<string | null>(null);
  useEffect((): (() => void) => {
    let live: boolean = true;
    void fetchDeployedEntry().then((entry: string | null): void => { if (live) setBuild(buildLabel(entry)); });
    return (): void => { live = false; };
  }, []);
  if (updater.settings === null || view === null) return null;
  const os: string = osLabel(facts);
  return (
    <div className="space-y-4">
      <AgentSection title="Citadel Agent" description="The program on this computer that holds your connections. Messages and files are encrypted end to end before they leave it.">
        <AgentVersionCard version={updater.settings.current || facts.version || null} os={os} channel={updater.settings.channel} mlDsaVerified={updater.settings.mlDsaVerified} />
      </AgentSection>
      <AgentSection title="Updates">
        <UpdateStatusPanel compact view={view} settings={updater.settings} onCheck={updater.check} restart={restart}
          action={<Button size="sm" variant="secondary" onClick={onOpenUpdates} data-testid="agent-open-updates">View updates</Button>} />
      </AgentSection>
      <AgentSection title="Links and help">
        <ul className="space-y-3 text-sm">
          <li className="flex items-start gap-3"><Download className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><AgentDownloadLink>Download page for every version</AgentDownloadLink></li>
          <li className="flex items-start gap-3"><BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><ExternalLink href={LICENSE_URL}>Licenses</ExternalLink></li>
          <li className="flex items-start gap-3 text-muted-foreground"><ScrollText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span data-testid="agent-logs-hint">{showLogsHint(os)}</span></li>
        </ul>
      </AgentSection>
      <p className="text-xs text-muted-foreground" data-testid="agent-workspace-build">Workspace build: {build ?? 'checking…'}</p>
    </div>
  );
}
