/**
 * What the "a newer Citadel Agent is available" banner says, and what it offers. Pure.
 *
 * The version it names is the site's (`/version.json`'s `agent`, released-agent.ts), which the
 * Deploy's "The site and the download agree" job holds equal to the latest release. The agent's
 * own word is not enough: it reads GitHub every six hours, so for hours after a release it still
 * offers the one before (2026-11-18: an agent on 0.11.0 offered 0.12.1 two hours after 0.13.0
 * shipped, and "Restart to update" would have installed the older one).
 *
 * Restart is offered only when the agent has exactly that version downloaded, verified and
 * installable by itself; everything else is a download of that version for this computer.
 */
import { installerUrlFor, type InstallerFamily } from '@/lib/agent-download';
import { isNewer } from './agent-version';
import { isReleaseLink, type AgentUpdate } from './update-state';

export interface AgentBanner {
  /** The release the banner names. */
  latest: string;
  /** What the agent runs. */
  current: string;
  /** The agent has `latest` ready and can install it itself: "Restart to update". */
  restart: boolean;
  /** `latest` for this computer. */
  downloadUrl: string;
  /** The agent has not seen `latest` yet: a window asks it to check (AgentUpdateWatcher). */
  stale: boolean;
}

export interface BannerInput {
  /** The site's latest agent release; null where the site does not say (a dev server). */
  released: string | null;
  /** The running agent's version, from its status; null before it has answered. */
  current: string | null;
  /** What the agent offers, if anything. */
  offer: AgentUpdate | null;
  /** This computer's installer family; undefined where none fits. */
  family: InstallerFamily | undefined;
}

/**
 * Where to download `version` here. The agent's own link when it is for that version: the agent
 * knows its install (a .deb or an AppImage). Otherwise the family's (agent-download.ts).
 */
export function downloadFor(version: string, offer: AgentUpdate | null, family: InstallerFamily | undefined): string {
  if (offer !== null && offer.latest === version && isReleaseLink(offer.downloadUrl)) return offer.downloadUrl;
  return installerUrlFor(version, family);
}

/** The banner, or null when there is nothing newer than what the agent runs. */
export function bannerFor({ released, current, offer, family }: BannerInput): AgentBanner | null {
  const latest: string | null = released ?? offer?.latest ?? null;
  const running: string | null = current ?? offer?.current ?? null;
  if (latest === null || running === null || !isNewer(latest, running)) return null;
  const offered: AgentUpdate | null = offer !== null && offer.latest === latest ? offer : null;
  return {
    latest,
    current: running,
    restart: offered !== null && offered.ready,
    downloadUrl: downloadFor(latest, offered, family),
    stale: offered === null,
  };
}
