import { CloudOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OUTAGE_CODE, OUTAGE_COPY, type OutageKind } from '@/lib/reconnect/outage';

/**
 * The whole page, in place of a workspace that a failure on the service's side keeps from
 * being shown (lib/reconnect/outage.ts): what happened in one line, the code support asks
 * for, and Retry. Opaque and above the workspace's own layers, below the connectivity strip.
 */
export function ServiceUnavailable({ kind, onRetry }: { kind: OutageKind; onRetry: () => void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-background px-4" data-testid="service-unavailable">
      <div role="alert" className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <CloudOff className="h-12 w-12 text-muted-foreground" aria-hidden="true" data-testid="service-unavailable-icon" />
        <h1 className="text-lg font-medium text-foreground" data-testid="service-unavailable-title">{OUTAGE_COPY.title}</h1>
        <p className="text-sm text-muted-foreground">
          {OUTAGE_COPY.codeLabel}{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground" data-testid="service-unavailable-code">{OUTAGE_CODE[kind]}</code>
        </p>
        <Button type="button" className="mt-2 h-[44px] min-w-[120px]" onClick={onRetry} data-testid="service-unavailable-retry">
          {OUTAGE_COPY.retry}
        </Button>
      </div>
    </div>
  );
}
