/**
 * What the agent offers this browser, and the one declaration a window makes.
 *
 * The agent hosts every account's ILM and owns its conversation store
 * (citadel-workspace docs/plans/multi-window-sessions.md); a window runs no ILM
 * of its own. The agent says in its greeting -- the first message on every
 * socket -- what else it does. The leader then declares on its socket, with
 * `ConnectionManagement::DeclareCapabilities`, whether this window hosts
 * Citadel apps; the answer, `AgentCapabilities`, says whether anything shows
 * the agent's native notices. An agent that does not answer is broken, and the
 * socket fails rather than guessing.
 *
 * The leader declares the moment the socket opens, BEFORE the connection is
 * reported up, so no request waits on an answer that has not been asked for.
 * A follower has no socket; it asks the leader what its socket was told.
 */
import { TIMEOUT } from '../timeout-constants';
import { greetingSupervises } from '@/types/agent-supervisor';
import { eventEmitter } from '../event-emitter';
import { createValueStore, type ValueStore } from '../value-store';
import { agentFacts, readGreetingFacts } from '../agent-update/agent-facts';
import type { InternalServiceRequest, InternalServiceResponse } from 'citadel-workspace-client-ts';

/** What the leader's socket offers to declare through. */
export interface DeclaringClient {
  sendDirectToInternalService(request: InternalServiceRequest): Promise<void>;
  nextResponse<T>(extract: (message: InternalServiceResponse) => T | undefined, timeoutMs: number): Promise<T>;
}

/** What the leader's agent said it does for this browser, read off its greeting (`ServiceConnectionAccepted`). */
export interface AgentOffers {
  /** The agent dials and heals peer links itself (types/agent-supervisor.ts). */
  supervisesP2p: boolean;
  /** The agent stages a browser file in chunks (`StageUploadChunk`); else inline only, 16 MiB. */
  stagesUploads: boolean;
  /** Whether the agent can open a file dialog on this machine (`native_picker`). */
  nativePicker: boolean;
  /** The agent takes this window's console lines into its opt-in diagnostic logs (`browser_console`). */
  takesConsole: boolean;
  /** The agent answers Citadel apps' requests (`apps`: AppFetch, AppKv, IhttpSend). */
  servesApps: boolean;
  /** The agent keeps the account's scratchpad and sends none of it (`notes_to_self`; lib/scratchpad). */
  notesToSelf: boolean;
}

/** What the leader tells a follower: its agent's capabilities, and `noticesHeard` as it stands. */
export type LeaderAnswer = AgentOffers & { noticesHeard: boolean };

/** Set once by the websocket service: which tab this is, and how a follower asks the leader. */
export interface CapabilityRoute {
  isLeader: () => boolean;
  askLeader: () => Promise<LeaderAnswer>;
}

/** Whether the agent supervises peer links: null until the agent has said. */
export const supervision: ValueStore<boolean | null> = createValueStore<boolean | null>('agent-supervises-p2p', null);

/**
 * Whether something on the agent's side shows its native notices: the menu-bar
 * app is subscribed (agent kernel/notices/heard.rs). Said in the declaration's
 * answer and again on every change. False until the agent says otherwise --
 * Windows and Linux have no notifier -- because a message left to an agent
 * that shows nothing reaches nobody.
 */
export const noticesHeard: ValueStore<boolean> = createValueStore<boolean>('agent-notices-heard', false);

/** Watches a new socket's first message, the agent's greeting, for what it offers. */
export interface Greeting {
  observe: (message: unknown) => void;
  offers: Promise<AgentOffers>;
}

let decided: Promise<AgentOffers> | null = null;
let route: CapabilityRoute | null = null;
let leaderWaiters: Array<(answer: Promise<AgentOffers>) => void> = [];

function inner(message: unknown, variant: string): Record<string, unknown> | undefined {
  const m: Record<string, unknown> = (message ?? {}) as Record<string, unknown>;
  const value: unknown = (m.Response as Record<string, unknown> | undefined)?.[variant] ?? m[variant];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function watchGreeting(): Greeting {
  let settle: (offers: AgentOffers) => void = (): void => undefined;
  const offers: Promise<AgentOffers> = new Promise<AgentOffers>((resolve) => { settle = resolve; });
  return {
    offers,
    observe: (message: unknown): void => {
      const greeting: Record<string, unknown> | undefined = inner(message, 'ServiceConnectionAccepted');
      if (greeting) agentFacts.set(readGreetingFacts(greeting));
      if (greeting) settle({ supervisesP2p: greetingSupervises(greeting), stagesUploads: greeting.stages_uploads === true, nativePicker: greeting.native_picker === true, takesConsole: greeting.browser_console === true, servesApps: greeting.apps === true, notesToSelf: greeting.notes_to_self === true });
      // The socket's every message passes here; the agent's change of notifier is one.
      const heard: Record<string, unknown> | undefined = inner(message, 'NoticesHeardNotification');
      if (heard) noticesHeard.set(heard.heard === true);
    },
  };
}

/**
 * `ihttp`: this window hosts Citadel apps, so the agent hands it P2P internal-HTTP frames
 * (`IhttpFrameNotification`). Every page hosts apps where the agent serves them.
 */
function declareRequest(requestId: string, hostsApps: boolean): InternalServiceRequest {
  return {
    ConnectionManagement: {
      request_id: requestId,
      management_command: { DeclareCapabilities: { capabilities: { ihttp: hostsApps } } },
    },
  };
}

/** The generated AgentCapabilities answering `requestId`, if `message` is it. */
function capabilitiesAnswering(message: unknown, requestId: string): Record<string, unknown> | undefined {
  const answer: Record<string, unknown> | undefined = inner(message, 'AgentCapabilities');
  return answer && answer.request_id === requestId ? answer : undefined;
}


function bounded<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => reject(new Error(what)), TIMEOUT.SESSION_MANAGEMENT_MS);
    promise.then((v: T) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

async function declare(client: DeclaringClient, greeting: Greeting): Promise<AgentOffers> {
  const offers: AgentOffers = await bounded(greeting.offers, 'The Citadel agent did not greet this connection');
  supervision.set(offers.supervisesP2p);
  const requestId: string = crypto.randomUUID();
  const answer: Promise<Record<string, unknown>> = client.nextResponse(
    (message: InternalServiceResponse) => capabilitiesAnswering(message, requestId),
    TIMEOUT.SESSION_MANAGEMENT_MS,
  );
  await client.sendDirectToInternalService(declareRequest(requestId, offers.servesApps));
  const answered: Record<string, unknown> = await answer;
  noticesHeard.set(answered.notices_heard === true);
  return offers;
}

/** The leader's socket just opened: declare on it, and let every caller wait for the answer. */
export function declareOnLeaderSocket(client: DeclaringClient, greeting: Greeting): Promise<AgentOffers> {
  const caps: Promise<AgentOffers> = declare(client, greeting);
  decided = caps;
  for (const wake of leaderWaiters) wake(caps);
  leaderWaiters = [];
  return caps;
}

/**
 * The leader's socket failed to open, so it will not declare. Its waiting
 * callers hear that failure rather than wait on a declaration that cannot come;
 * nothing is remembered, so the next socket is asked afresh.
 */
export function leaderSocketFailedToOpen(error: unknown): void {
  const failed: Promise<AgentOffers> = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  failed.catch((): void => undefined);
  for (const wake of leaderWaiters) wake(failed);
  leaderWaiters = [];
}

let stopWatchingLeaderSocket: (() => void) | null = null;

export function registerCapabilityRoute(r: CapabilityRoute): void {
  route = r;
  // A follower's answer was about the leader's old socket; the leader declares
  // afresh on each one (forgetCapabilities), so the follower asks afresh too.
  stopWatchingLeaderSocket?.();
  stopWatchingLeaderSocket = eventEmitter.on<{ up: boolean }>('agent-socket-state', ({ up }): void => {
    if (!up && !r.isLeader()) decided = null;
  });
}

/** Everything the agent said it does for this browser; waits until it has said. */
export function agentCapabilities(): Promise<AgentOffers> {
  if (decided) return decided;
  // No websocket service in this context (a test, a page without one): no agent offers anything.
  if (!route) return Promise.resolve({ supervisesP2p: false, stagesUploads: false, nativePicker: false, takesConsole: false, servesApps: false, notesToSelf: false });
  // The leader's own socket has not declared yet: its answer is the one.
  if (route.isLeader()) return new Promise<AgentOffers>((resolve, reject) => { leaderWaiters.push((a) => a.then(resolve, reject)); });
  const asked: Promise<AgentOffers> = route.askLeader().then(
    ({ noticesHeard: heard, ...caps }: LeaderAnswer): AgentOffers => {
      supervision.set(caps.supervisesP2p);
      // Kept current afterwards by the leader's broadcast (notices-heard-relay.ts).
      noticesHeard.set(heard);
      return caps;
    },
    (error: unknown): never => {
      if (decided === asked) decided = null; // asked again next time, not failed for good
      throw error;
    },
  );
  decided = asked;
  return asked;
}

/** Whether the agent dials and heals this browser's peer links; waits until the agent has said. */
export function agentSupervisesP2p(): Promise<boolean> {
  return agentCapabilities().then((c: AgentOffers): boolean => c.supervisesP2p);
}

/** Whether the agent stages browser files in chunks; waits until the agent has said. */
export function agentStagesUploads(): Promise<boolean> {
  return agentCapabilities().then((c: AgentOffers): boolean => c.stagesUploads);
}

/** Whether the agent can open a native file dialog; waits until the agent has said. */
export function agentNativePicker(): Promise<boolean> {
  return agentCapabilities().then((c: AgentOffers): boolean => c.nativePicker);
}

/** Whether the agent keeps notes to self unsent, so the scratchpad may write; waits until it has said. */
export function agentKeepsNotesToSelf(): Promise<boolean> {
  return agentCapabilities().then((c: AgentOffers): boolean => c.notesToSelf);
}

/** The socket this answer was for is gone; the next socket declares again. */
export function forgetCapabilities(): void {
  decided = null;
  supervision.set(null);
  noticesHeard.set(false);
  agentFacts.set({});
}
