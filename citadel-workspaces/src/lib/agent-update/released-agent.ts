/**
 * The latest agent release, as the site says: `/version.json`'s `agent` (pwa/deployed-version.ts),
 * the agent crate's version this build shipped with, which the Deploy's "The site and the
 * download agree" job holds equal to the latest release. The banner names this, not the agent's
 * own opinion (banner-model.ts).
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';
import { VERSION_MANIFEST_PATH, readDeployedAgent } from '@/lib/pwa/deployed-version';
import { debugLog } from '@/lib/debug-config';

/** Null until read, and where the site does not say (a dev server answers the SPA shell). */
export const releasedAgent: ValueStore<string | null> = createValueStore<string | null>('released-agent', null);

export type FetchManifest = (path: string) => Promise<Response>;

/** Read the site's latest agent release into `releasedAgent`. */
export async function loadReleasedAgent(fetchManifest: FetchManifest): Promise<void> {
  try {
    const response: Response = await fetchManifest(VERSION_MANIFEST_PATH);
    if (!response.ok) {
      debugLog('AgentUpdate', `${VERSION_MANIFEST_PATH} answered ${response.status}`);
      return;
    }
    releasedAgent.set(readDeployedAgent(await response.json()));
  } catch (e: unknown) {
    // Not a manifest (the dev server's SPA shell) or offline: the agent's offer is all there is.
    debugLog('AgentUpdate', `no released agent from ${VERSION_MANIFEST_PATH}`, e);
  }
}

/** The page's own fetch, uncached: a deploy changes the answer. */
export const fetchSiteManifest: FetchManifest = (path: string): Promise<Response> => fetch(path, { cache: 'no-store' });
