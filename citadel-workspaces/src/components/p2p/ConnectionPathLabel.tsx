/**
* "Direct", "Relayed" or "Reconnecting…", beside the peer's status in the chat header.
 *
 * A connection is usable from the moment it is delivered, over the server
 * relay, and may go direct later; this says which it is now. It is information
 * only: nothing waits for "Direct".
 */
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { chatPathLabel, type ChatPathLabel } from '@/lib/ice-servers/chat-path-copy';
import type { PeerPathReport } from '@/types/ice-servers';
import type { SupervisorState } from '@/types/agent-supervisor';

const PILL: string = 'rounded-full px-1.5 font-medium';

export function ConnectionPathLabel({ route, supervisor }: { route: PeerPathReport | null; supervisor: SupervisorState | null }): JSX.Element | null {
  const label: ChatPathLabel | null = chatPathLabel(route, supervisor);
  if (label === null) return null;
  const tone: string = label.direct ? 'bg-success/20 text-success-emphasis' : 'bg-surface text-muted-foreground';
  const pill: JSX.Element = (
    <span className={`${PILL} ${tone}`} data-testid="chat-connection-path" data-direct={label.direct}>
      {label.text}
    </span>
  );
  if (label.tooltip === null) return pill;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        {/* A button so the explanation is reachable by keyboard, not only on hover. It does nothing else. */}
        <TooltipTrigger asChild>
          <button type="button" aria-label={`${label.text}: ${label.tooltip}`} className="cursor-help rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {pill}
          </button>
        </TooltipTrigger>
        <TooltipContent>{label.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
