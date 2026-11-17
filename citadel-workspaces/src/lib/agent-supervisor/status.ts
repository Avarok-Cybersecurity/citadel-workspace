/**
 * What the agent's supervisor says about each link, for the connection status UI.
 *
 * "healing" reads as "Reconnecting…", "degraded" as the relayed pill, and
 * "healed" clears either. A state without a peer is about the account's server
 * link and applies to every peer of that session until the supervisor says it
 * healed. Path changes (Relayed, Direct) are not here: they are the existing
 * PeerPathChangedNotification (p2p-auto-connect-service/path-changes.ts).
 *
 * Like path changes, the leader records every event it sees on the wire, so a
 * late follower's snapshot is not stale; the router also hands the owning tab
 * its own copy, and recording twice is the same write.
 */
import { SUPERVISOR_NOTIFICATION, WIRE_STATES, type SupervisorState } from '@/types/agent-supervisor';

export const SUPERVISOR_STATUS_EVENT: 'p2p:supervisor-status' = 'p2p:supervisor-status';

export interface SupervisorEvent {
  cid: bigint;
  /** The peer the state is about; null when it is about the account's server link. */
  peerCid: bigint | null;
  state: SupervisorState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The event a wire message carries; null for anything else, including a malformed one. */
export function readSupervisorEvent(message: unknown): SupervisorEvent | null {
  const unwrapped: unknown = isRecord(message) && isRecord(message.Response) ? message.Response : message;
  if (!isRecord(unwrapped)) return null;
  const body: unknown = unwrapped[SUPERVISOR_NOTIFICATION];
  if (!isRecord(body)) return null;
  // serde-wasm-bindgen hands a Rust None to JavaScript as undefined, not null.
  const peer: unknown = body.peer_cid ?? null;
  const state: SupervisorState | undefined = typeof body.state === 'string' ? WIRE_STATES[body.state] : undefined;
  if (typeof body.cid !== 'bigint' || state === undefined) return null;
  if (peer !== null && typeof peer !== 'bigint') return null;
  return { cid: body.cid, peerCid: peer, state };
}

type Active = Exclude<SupervisorState, 'healed'>;

const accounts: Map<bigint, Active> = new Map<bigint, Active>();
const peers: Map<bigint, Map<bigint, Active>> = new Map<bigint, Map<bigint, Active>>();

/** Records the event; returns whether anything a reader sees changed. */
export function recordSupervisorEvent(event: SupervisorEvent): boolean {
  const before: Active | null = supervisorStateFor(event.cid, event.peerCid);
  const next: Active | null = event.state === 'healed' ? null : event.state;
  if (event.peerCid === null) {
    if (next === null) accounts.delete(event.cid); else accounts.set(event.cid, next);
    // A healed server link says nothing about a peer still being redialled, so peer entries stay.
    return before !== supervisorStateFor(event.cid, null);
  }
  const forSession: Map<bigint, Active> = peers.get(event.cid) ?? new Map<bigint, Active>();
  if (next === null) forSession.delete(event.peerCid); else forSession.set(event.peerCid, next);
  if (forSession.size === 0) peers.delete(event.cid); else peers.set(event.cid, forSession);
  return before !== supervisorStateFor(event.cid, event.peerCid);
}

/** The peer's own state, else the account's; null when nothing is being healed. */
export function supervisorStateFor(cid: bigint | null, peerCid: bigint | null): Active | null {
  if (cid === null) return null;
  const own: Active | undefined = peerCid === null ? undefined : peers.get(cid)?.get(peerCid);
  return own ?? accounts.get(cid) ?? null;
}

export interface SupervisorStatusDeps {
  bus: {
    on: (event: string, handler: (payload: unknown) => void) => unknown;
    /** Readers re-read on the event; the payload is the change that prompted it, absent when the socket's loss did. */
    emit: (event: string, change?: SupervisorEvent) => void;
  };
  isLeader: () => boolean;
  /** The event carrying every wire message on the leader, before routing. */
  wireEvent: string;
}

let installed: boolean = false;

/**
 * Listens for the supervisor's reports. Installed once the agent is known to
 * supervise (it reports only then), so the listener, and this module, load off
 * the landing path; a second call, for the next socket, does nothing.
 */
export function installSupervisorStatus({ bus, isLeader, wireEvent }: SupervisorStatusDeps): void {
  if (installed) return;
  installed = true;
  const apply = (message: unknown): void => {
    const event: SupervisorEvent | null = readSupervisorEvent(message);
    if (event !== null && recordSupervisorEvent(event)) bus.emit(SUPERVISOR_STATUS_EVENT, event);
  };
  bus.on('websocket-message', apply);
  bus.on(wireEvent, (message: unknown): void => { if (isLeader()) apply(message); });
  // A healed report can only arrive on a live socket. Without this, a link the
  // agent was healing when the socket died read "Reconnecting…" for good.
  bus.on('websocket-disconnected', (): void => {
    if (clearSupervisorStatus()) bus.emit(SUPERVISOR_STATUS_EVENT);
  });
}

/** Forgets everything: the socket that reported it is gone. Returns whether anything was shown. */
export function clearSupervisorStatus(): boolean {
  const hadAny: boolean = accounts.size > 0 || peers.size > 0;
  accounts.clear();
  peers.clear();
  return hadAny;
}
