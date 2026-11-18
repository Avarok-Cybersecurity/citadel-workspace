import { Button } from '@/components/ui/button';
import type { RestartPhase } from '@/lib/agent-update/restart-flow';

/**
 * How a restart ended, for the banner and the Updates tab alike: the new version, or why not and
 * the download of the version that was asked for. Nothing while idle or restarting. Not a live
 * region itself: each place it shows is one.
 */
export function RestartOutcome({ phase, downloadUrl }: { phase: RestartPhase; downloadUrl: (version: string) => string }): JSX.Element | null {
  if (phase.kind === 'updated') {
    return <p className="text-sm text-success-emphasis" data-testid="agent-update-updated">Updated to Citadel Agent {phase.version}.</p>;
  }
  if (phase.kind !== 'failed') return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-destructive-emphasis" data-testid="agent-update-failed">{phase.message}</span>
      <Button size="sm" asChild>
        <a href={downloadUrl(phase.target)} target="_blank" rel="noopener noreferrer" data-testid="agent-update-failed-download">
          Download {phase.target}<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Button>
    </span>
  );
}
