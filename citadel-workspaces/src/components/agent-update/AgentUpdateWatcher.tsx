/**
 * Keeps this window's view of the agent's updater current: every `UpdateAvailable` the agent
 * broadcasts, its status once at start (an agent before 0.8.7 does not answer, and then there is
 * simply nothing to show), and the site's latest release (released-agent.ts). Shows the banner
 * when there is something newer than the agent runs, or a restart to report on.
 *
 * An agent that has not seen the site's latest yet (it reads GitHub every six hours) is asked to
 * check, once per release per window, so that "Restart to update" can be offered for the version
 * the banner names rather than the one before it.
 *
 * The banner lives here, in a chunk the app loads lazily, rather than in the top banner
 * stack, which the landing page renders: the stack importing it, or even its store, put the
 * landing page over its budget (check-bundle-budget). So it is its own strip, pinned under
 * the header and the stack.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { eventEmitter } from '@/lib/event-emitter';
import { agentPlatformCandidates, installerFamily, type InstallerFamily } from '@/lib/agent-download';
import { askUpdater } from '@/lib/agent-update/requests';
import { debugLog } from '@/lib/debug-config';
import { agentUpdate, applyUpdaterMessage, updaterSettings, type AgentUpdate, type UpdaterSettings } from '@/lib/agent-update/update-state';
import { bannerFor, type AgentBanner } from '@/lib/agent-update/banner-model';
import { fetchSiteManifest, loadReleasedAgent, releasedAgent } from '@/lib/agent-update/released-agent';
import { restartPhase } from '@/lib/agent-update/restart-controller';
import type { RestartPhase } from '@/lib/agent-update/restart-flow';
import type { TypesStep } from '@/lib/agent-update/types-step';
import { AgentUpdateBanner } from './AgentUpdateBanner';
import { TypesStepBanner, useTypesStep } from './TypesStepBanner';

/** The releases this window has already asked a stale agent to check for. */
const askedToCatchUp: Set<string> = new Set<string>();

export function AgentUpdateWatcher(): JSX.Element | null {
  const update: AgentUpdate | null = useSyncExternalStore(agentUpdate.subscribe, agentUpdate.get);
  const settings: UpdaterSettings | null = useSyncExternalStore(updaterSettings.subscribe, updaterSettings.get);
  const released: string | null = useSyncExternalStore(releasedAgent.subscribe, releasedAgent.get);
  const phase: RestartPhase = useSyncExternalStore(restartPhase.subscribe, restartPhase.get);
  const onAgentPage: boolean = useLocation().pathname === '/agent';
  const family: InstallerFamily | undefined = useMemo(() => installerFamily(agentPlatformCandidates()), []);
  useEffect(() => {
    const off: () => void = eventEmitter.on('websocket-message', (message: unknown): void => {
      applyUpdaterMessage(message);
    });
    askUpdater('UpdateGetStatus').catch((e: unknown): void => debugLog('AgentUpdate', 'no updater status', e));
    void loadReleasedAgent(fetchSiteManifest);
    return off;
  }, []);
  const current: string | null = settings !== null && settings.current !== '' ? settings.current : null;
  const banner: AgentBanner | null = bannerFor({ released, current, offer: update, family });
  const catchUp: string | null = banner !== null && banner.stale && released !== null ? banner.latest : null;
  useEffect(() => {
    if (catchUp === null || askedToCatchUp.has(catchUp)) return;
    askedToCatchUp.add(catchUp);
    askUpdater('UpdateCheckNow').catch((e: unknown): void => debugLog('AgentUpdate', `the agent did not check for ${catchUp}`, e));
  }, [catchUp]);
  const types: TypesStep | null = useTypesStep();
  const typesWrong: boolean = types !== null && types.kind !== 'in-step';
  // The /agent page shows the same update in full; a strip above it would say it twice. Being
  // out of step is said on every page, /agent too: it explains failures anywhere.
  const showUpdate: boolean = !onAgentPage && (banner !== null || phase.kind !== 'idle');
  if (!showUpdate && !typesWrong) return null;
  return (
    <div className="fixed inset-x-0 top-[calc(var(--app-header-height,0px)+var(--offline-banner-height,0px))] z-[105]">
      <TypesStepBanner step={types} />
      {showUpdate ? <AgentUpdateBanner banner={banner} offer={update} family={family} /> : null}
    </div>
  );
}
