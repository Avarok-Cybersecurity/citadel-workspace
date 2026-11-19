import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { InstallerFamily } from '@/lib/agent-download';
import { downloadFor, type AgentBanner } from '@/lib/agent-update/banner-model';
import type { RestartPhase } from '@/lib/agent-update/restart-flow';
import type { AgentUpdate } from '@/lib/agent-update/update-state';
import { RestartOutcome } from './RestartOutcome';
import { RestartToUpdate } from './RestartToUpdate';
import { useRestartToUpdate, type RestartControl } from './use-restart-to-update';

export interface AgentUpdateBannerProps {
  /** What is newer than the agent (banner-model.ts); null once nothing is. */
  banner: AgentBanner | null;
  /** The agent's own offer, for its download link (it knows its install). */
  offer: AgentUpdate | null;
  family: InstallerFamily | undefined;
}

/** The version the strip is about: the restart's while there is one, else the newer release. */
function namedVersion(phase: RestartPhase, banner: AgentBanner | null): string | null {
  if (phase.kind === 'updated') return phase.version;
  if (phase.kind === 'restarting' || phase.kind === 'failed') return phase.target;
  return banner?.latest ?? null;
}

/**
 * "Citadel Agent X.Y.Z is available", non-blocking, naming the site's latest release. "Restart to
 * update" when the agent has that release downloaded and verified and can install it itself
 * (after saying what that costs); "Download X.Y.Z" otherwise. A restart always ends: "Updated to
 * X.Y.Z", or why not with the download (restart-flow.ts). The restart itself is RestartToUpdate's,
 * the same one the Updates tab uses.
 */
export function AgentUpdateBanner({ banner, offer, family }: AgentUpdateBannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const restart: RestartControl = useRestartToUpdate();
  const { phase } = restart;
  const named: string | null = namedVersion(phase, banner);
  if (named === null || (phase.kind === 'idle' && dismissed === named)) return null;
  const settled: boolean = phase.kind === 'updated' || phase.kind === 'failed';
  return (
    <div role="status" aria-live="polite" data-testid="agent-update-banner" data-ready={banner?.restart ?? false} data-phase={phase.kind}
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm bg-muted text-foreground border-b border-surface">
      <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-semibold">
          {phase.kind === 'updated' ? `Citadel Agent ${named} is installed` : `Citadel Agent ${named} is available`}
        </strong>
        {phase.kind === 'restarting' && ' — restarting the agent…'}
      </span>
      {settled && <RestartOutcome phase={phase} downloadUrl={(v: string): string => downloadFor(v, offer, family)} />}
      {!settled && banner !== null && (banner.restart ? (
        <RestartToUpdate version={banner.latest} from={banner.current} restart={restart} />
      ) : (
        <Button size="sm" variant="secondary" asChild>
          <a href={banner.downloadUrl} target="_blank" rel="noopener noreferrer" data-testid="agent-update-download">Download {banner.latest}</a>
        </Button>
      ))}
      <Button size="sm" variant="ghost" data-testid="agent-update-later" disabled={phase.kind === 'restarting'}
        onClick={(): void => { restart.dismiss(); setDismissed(named); }}>
        {settled ? 'Close' : 'Later'}
      </Button>
    </div>
  );
}
