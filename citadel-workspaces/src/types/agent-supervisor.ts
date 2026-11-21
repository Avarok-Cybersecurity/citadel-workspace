/**
 * The agent's connection supervisor, as the UI spells it on the wire.
 *
 * Every name the UI shares with the supervisor (agent `kernel/supervisor`,
 * docs/plans/connection-supervisor.md) is defined here and nowhere else, so a
 * rename on the agent side is a one-file change. The generated bindings do not
 * carry these yet; when they do, the shapes below are replaced by the generated
 * ones and the functions keep their signatures.
 *
 * - Capability `supervises_p2p`, a field of the agent's greeting: the agent
 *   dials, retries and heals this browser's peer links
 *   itself, so the UI's auto-connect stands down.
 * - Request `ConnectionManagement::Interest { session_cid, peer_cid, until }` (built in
 *   lib/agent-supervisor/interest.ts, which loads only once a supervising agent is
 *   known, to keep it off the landing path): "an open chat
 *   or call wants this peer until `until`" (Unix ms). Never an instruction to
 *   dial; the supervisor decides.
 * - Notification `SupervisorNotification { cid, peer_cid?, state }`, addressed
 *   to the session in `cid` and answering no request. Without `peer_cid` it is
 *   about the account's server link. Path changes are not this notification:
 *   they are the existing PeerPathChangedNotification.
 */
import type { ConfigCommand, DiscriminatorOf, ResponseType, ServiceConnectionAccepted, SupervisorState } from 'citadel-workspace-client-ts';

export const SUPERVISES_P2P_CAPABILITY = 'supervises_p2p' as const satisfies keyof ServiceConnectionAccepted;
export const SUPERVISOR_NOTIFICATION = 'SupervisorNotification' as const satisfies ResponseType;
export const INTEREST_COMMAND = 'Interest' as const satisfies DiscriminatorOf<ConfigCommand>;

/** What the chat header shows for the generated `SupervisorState` it was sent. */
export type SupervisorPhase = 'healing' | 'healed' | 'degraded';

export const WIRE_STATES: Readonly<Record<SupervisorState, SupervisorPhase>> = {
  Healing: 'healing',
  Healed: 'healed',
  Degraded: 'degraded',
};

/** Whether a greeting declares the capability. */
export function greetingSupervises(greeting: Record<string, unknown>): boolean {
  return greeting[SUPERVISES_P2P_CAPABILITY] === true;
}
