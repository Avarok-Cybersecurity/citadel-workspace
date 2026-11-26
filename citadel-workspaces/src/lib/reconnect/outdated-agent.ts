/**
 * Whose failure a session's outage is. A workspace that will not come back while the agent on
 * this computer is older than the site's release (`/version.json`'s `agent`,
 * agent-update/released-agent.ts) is not the service failing: a server refuses an agent that
 * speaks an older protocol, and an agent old enough to predate the refusal's code reports it
 * only as a server that never answers. Telling that user "the error is on us — please check
 * back soon" leaves them waiting for something only they can fix.
 *
 * So the notice for an outdated agent says to update it, with the download; every other
 * outage is the service's, as before. Pure.
 */
import type { AgentBanner } from '@/lib/agent-update/banner-model';
import type { OutageKind } from './outage';

/**
 * The protocol versions at which workspace servers stopped taking part with older agents. From
 * each of them on, an agent that has not been updated is refused by the server by name, and
 * nothing its user does in the page changes that; so each one ships with this notice.
 *
 * A server kernel test reads this list and refuses a build whose SDK's oldest admitted
 * protocol version is not in it
 * (citadel-workspace-server-kernel/tests/a_protocol_step_ships_with_its_update_notice.rs): a
 * server that starts refusing older agents cannot ship without this page beside it.
 */
export const PROTOCOL_STEPS_WITH_AN_UPDATE_NOTICE: readonly string[] = ['0.12.6', '0.12.7'];

export type OutageView =
  | { kind: 'service'; outage: OutageKind }
  | { kind: 'update-agent'; outage: OutageKind; latest: string; current: string; downloadUrl: string; restart: boolean };

/**
 * What to show for `outage`. `newer` is the release newer than the running agent
 * (banner-model.ts `bannerFor`), or null when the agent is current or its version is unknown.
 */
export function outageView(outage: OutageKind, newer: AgentBanner | null): OutageView {
  if (newer === null) return { kind: 'service', outage };
  return { kind: 'update-agent', outage, latest: newer.latest, current: newer.current, downloadUrl: newer.downloadUrl, restart: newer.restart };
}

export const UPDATE_AGENT_COPY: {
  readonly title: string;
  readonly detail: (current: string, latest: string) => string;
  readonly download: (latest: string) => string;
  readonly restartHint: string;
  readonly retry: string;
} = {
  title: 'Update the Citadel agent on this computer',
  detail: (current: string, latest: string): string =>
    `This workspace needs Citadel Agent ${latest}. This computer runs ${current}, which can no longer connect to it.`,
  download: (latest: string): string => `Download ${latest}`,
  restartHint: 'The update is already downloaded: choose Restart to update in the banner above.',
  retry: 'Retry',
};
