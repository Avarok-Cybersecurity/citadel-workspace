import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OUTAGE_CODE, OUTAGE_COPY } from '@/lib/reconnect/outage';
import { UPDATE_AGENT_COPY, type OutageView } from '@/lib/reconnect/outdated-agent';

/**
 * The whole page, in place of a workspace an outdated agent cannot reach
 * (lib/reconnect/outdated-agent.ts): what to do, the two versions, the download, and Retry for
 * once it is done. Laid out as ServiceUnavailable is, so the two read as the same place.
 */
export function UpdateAgentNotice({ view, onRetry }: { view: Extract<OutageView, { kind: 'update-agent' }>; onRetry: () => void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-background px-4" data-testid="update-agent-notice">
      <div role="alert" className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <Download className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-medium text-foreground" data-testid="update-agent-title">{UPDATE_AGENT_COPY.title}</h1>
        <p className="text-sm text-muted-foreground" data-testid="update-agent-detail">{UPDATE_AGENT_COPY.detail(view.current, view.latest)}</p>
        {view.restart ? <p className="text-sm text-muted-foreground" data-testid="update-agent-restart-hint">{UPDATE_AGENT_COPY.restartHint}</p> : null}
        <p className="text-sm text-muted-foreground">
          {OUTAGE_COPY.codeLabel}{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground" data-testid="update-agent-code">{OUTAGE_CODE[view.outage]}</code>
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button asChild className="h-[44px] min-w-[120px]">
            <a href={view.downloadUrl} target="_blank" rel="noopener noreferrer" data-testid="update-agent-download">{UPDATE_AGENT_COPY.download(view.latest)}</a>
          </Button>
          <Button type="button" variant="secondary" className="h-[44px] min-w-[120px]" onClick={onRetry} data-testid="update-agent-retry">
            {UPDATE_AGENT_COPY.retry}
          </Button>
        </div>
      </div>
    </div>
  );
}
