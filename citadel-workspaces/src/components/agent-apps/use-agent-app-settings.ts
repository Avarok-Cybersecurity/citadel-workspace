/**
 * The signed-in member's private-network grant for apps on this agent: read when the page has a
 * session, and changed through the agent, which holds it. Shaped like use-updater.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AppsAgentSettings } from 'citadel-internal-service-wasm-client';
import { readAgentAppSettings, setAppsPrivateNetwork } from '@/lib/agent-apps/settings-requests';
import { describeFailure } from '@/lib/failure-message';

export interface AgentAppSettings {
  /** The session the grant is for; null with nobody signed in in this window. */
  cid: bigint | null;
  /** Null until the agent has said. */
  privateNetwork: boolean | null;
  /** What went wrong reading or saving it, in words. */
  error: string | null;
  setPrivateNetwork: (on: boolean) => void;
}

/** `resolveCid` names the session this window acts as (lib/p2p/current-cid.ts in the page). */
export function useAgentAppSettings(resolveCid: () => Promise<bigint | null>): AgentAppSettings {
  const [cid, setCid] = useState<bigint | null>(null);
  const [privateNetwork, setPrivate] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect((): (() => void) => {
    let live: boolean = true;
    const read = async (): Promise<void> => {
      const session: bigint | null = await resolveCid();
      if (!live) return;
      setCid(session);
      if (session === null) return;
      const held: AppsAgentSettings = await readAgentAppSettings(session);
      if (live) setPrivate(held.private_network);
    };
    read().catch((e: unknown): void => { if (live) setError(describeFailure(e, 'The setting could not be read.')); });
    return (): void => { live = false; };
  }, [resolveCid]);

  const setPrivateNetwork: (on: boolean) => void = useCallback((on: boolean): void => {
    if (cid === null) return;
    setError(null);
    setAppsPrivateNetwork(cid, on).then(
      (held: AppsAgentSettings): void => setPrivate(held.private_network),
      (e: unknown): void => setError(describeFailure(e, 'The setting was not saved.')),
    );
  }, [cid]);

  return { cid, privateNetwork, error, setPrivateNetwork };
}
