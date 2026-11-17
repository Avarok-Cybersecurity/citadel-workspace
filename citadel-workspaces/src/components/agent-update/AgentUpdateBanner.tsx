import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AgentUpdate } from '@/lib/agent-update/update-state';
import { RestartToUpdate } from './RestartToUpdate';
import { useRestartToUpdate, type RestartControl } from './use-restart-to-update';

function progressText(restart: RestartControl): string {
  if (restart.phase.kind === 'restarting') return ' — restarting the agent…';
  return restart.phase.kind === 'failed' ? ` — ${restart.phase.message}` : '';
}

/**
 * "Citadel Agent X.Y.Z is available", non-blocking. "Restart to update" when the agent has
 * the release downloaded and verified (after saying what that costs); "Download" when it can
 * only link out (a package-managed or Windows install). The restart itself is RestartToUpdate's,
 * the same one the Updates tab uses.
 */
export function AgentUpdateBanner({ update }: { update: AgentUpdate }): JSX.Element | null {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const restart: RestartControl = useRestartToUpdate();
  if (dismissed === update.latest) return null;
  return (
    <div role="status" aria-live="polite" data-testid="agent-update-banner" data-ready={update.ready}
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm bg-muted text-foreground border-b border-surface">
      <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-semibold">Citadel Agent {update.latest} is available</strong>
        {progressText(restart)}
      </span>
      {update.ready ? (
        <RestartToUpdate version={update.latest} restart={restart} />
      ) : (
        <Button size="sm" variant="secondary" asChild>
          <a href={update.downloadUrl} target="_blank" rel="noopener noreferrer" data-testid="agent-update-download">Download</a>
        </Button>
      )}
      <Button size="sm" variant="ghost" data-testid="agent-update-later" onClick={(): void => setDismissed(update.latest)}>Later</Button>
    </div>
  );
}
