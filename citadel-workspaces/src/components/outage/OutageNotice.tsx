import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { agentPlatformCandidates, installerFamily, type InstallerFamily } from '@/lib/agent-download';
import { bannerFor, type AgentBanner } from '@/lib/agent-update/banner-model';
import { fetchSiteManifest, loadReleasedAgent, releasedAgent } from '@/lib/agent-update/released-agent';
import { askUpdater } from '@/lib/agent-update/requests';
import { agentUpdate, updaterSettings, type AgentUpdate, type UpdaterSettings } from '@/lib/agent-update/update-state';
import { debugLog } from '@/lib/debug-config';
import type { OutageKind } from '@/lib/reconnect/outage';
import { outageView, type OutageView } from '@/lib/reconnect/outdated-agent';
import { ServiceUnavailable } from './ServiceUnavailable';
import { UpdateAgentNotice } from './UpdateAgentNotice';

/** The release newer than the agent this window talks to, from the same sources as the update banner. */
function useNewerAgent(): AgentBanner | null {
  const update: AgentUpdate | null = useSyncExternalStore(agentUpdate.subscribe, agentUpdate.get);
  const settings: UpdaterSettings | null = useSyncExternalStore(updaterSettings.subscribe, updaterSettings.get);
  const released: string | null = useSyncExternalStore(releasedAgent.subscribe, releasedAgent.get);
  const family: InstallerFamily | undefined = useMemo(() => installerFamily(agentPlatformCandidates()), []);
  useEffect(() => {
    // The site may have deployed since this page last read it: that is when this notice matters.
    void loadReleasedAgent(fetchSiteManifest);
    if (updaterSettings.get() === null) {
      askUpdater('UpdateGetStatus').catch((e: unknown): void => debugLog('Outage', 'no updater status', e));
    }
  }, []);
  const current: string | null = settings !== null && settings.current !== '' ? settings.current : null;
  return bannerFor({ released, current, offer: update, family });
}

/**
 * The page shown in place of a workspace that cannot be reached: the service's failure, or,
 * when the agent on this computer is older than the site's release, the update it needs
 * (lib/reconnect/outdated-agent.ts).
 */
export function OutageNotice({ kind, onRetry }: { kind: OutageKind; onRetry: () => void }): JSX.Element {
  const view: OutageView = outageView(kind, useNewerAgent());
  if (view.kind === 'update-agent') return <UpdateAgentNotice view={view} onRetry={onRetry} />;
  return <ServiceUnavailable kind={view.outage} onRetry={onRetry} />;
}
