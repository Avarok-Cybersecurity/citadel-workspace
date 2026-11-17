/**
 * What the chat header's pill says about a connection. Its own module, loaded
 * with the chat: the peer list, which is on the landing path, needs only the
 * path names in path-copy.ts.
 */
import type { SupervisorState } from '@/types/agent-supervisor';
import type { PeerPathReport } from '@/types/ice-servers';
import { CONNECTION_PATH_COPY } from './path-copy';

export const CHAT_PATH_COPY: Readonly<{ relayed: string; upgrading: string; reconnecting: string; healing: string; degraded: string }> = {
  relayed: 'Relayed',
  upgrading: 'Messages go through the server while a direct connection is set up',
  reconnecting: 'Reconnecting…',
  healing: 'The agent is bringing this connection back',
  degraded: 'A direct connection could not be restored; messages go through a relay',
};

/** The chat header's short label for a connection's path. */
export interface ChatPathLabel {
  text: string;
  /** Why it reads as it does; null when the label says it all. */
  tooltip: string | null;
  direct: boolean;
}

/**
 * "Direct", or "Relayed" for a TURN or server-relay path. While an upgrade is
 * under way the tooltip says so; a relay that will stay says which relay.
 * What a supervising agent says comes first: "Reconnecting…" while it heals the
 * link, and "Relayed" when it gave up on a direct path.
 */
export function chatPathLabel(route: PeerPathReport | null, supervisor: SupervisorState | null): ChatPathLabel | null {
  if (supervisor === 'healing') return { text: CHAT_PATH_COPY.reconnecting, tooltip: CHAT_PATH_COPY.healing, direct: false };
  if (supervisor === 'degraded') return { text: CHAT_PATH_COPY.relayed, tooltip: CHAT_PATH_COPY.degraded, direct: false };
  if (route === null) return null;
  if (route.path === 'direct') return { text: CONNECTION_PATH_COPY.direct, tooltip: null, direct: true };
  const tooltip: string = route.upgrading ? CHAT_PATH_COPY.upgrading : CONNECTION_PATH_COPY[route.path];
  return { text: CHAT_PATH_COPY.relayed, tooltip, direct: false };
}
