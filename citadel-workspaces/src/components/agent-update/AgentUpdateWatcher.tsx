/**
 * Keeps this window's view of the agent's updater current: every `UpdateAvailable`
 * the agent broadcasts, and its status once at start (an agent before 0.8.7 does not
 * answer, and then there is simply nothing to show). Shows the banner when there is one.
 *
 * The banner lives here, in a chunk the app loads lazily, rather than in the top banner
 * stack, which the landing page renders: the stack importing it, or even its store, put the
 * landing page over its budget (check-bundle-budget). So it is its own strip, pinned under
 * the header and the stack.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { eventEmitter } from '@/lib/event-emitter';
import { applyUpdaterMessage } from '@/lib/agent-update/update-state';
import { askUpdater } from '@/lib/agent-update/requests';
import { debugLog } from '@/lib/debug-config';
import { agentUpdate, type AgentUpdate } from '@/lib/agent-update/update-state';
import { AgentUpdateBanner } from './AgentUpdateBanner';

export function AgentUpdateWatcher(): JSX.Element | null {
  const update: AgentUpdate | null = useSyncExternalStore(agentUpdate.subscribe, agentUpdate.get);
  const onAgentPage: boolean = useLocation().pathname === '/agent';
  useEffect(() => {
    const off: () => void = eventEmitter.on('websocket-message', (message: unknown): void => {
      applyUpdaterMessage(message);
    });
    askUpdater('UpdateGetStatus').catch((e: unknown): void => debugLog('AgentUpdate', 'no updater status', e));
    return off;
  }, []);
  // The /agent page shows the same update in full; a strip above it would say it twice.
  if (!update || onAgentPage) return null;
  return (
    <div className="fixed inset-x-0 top-[calc(var(--app-header-height,0px)+var(--offline-banner-height,0px))] z-[105]">
      <AgentUpdateBanner update={update} />
    </div>
  );
}
