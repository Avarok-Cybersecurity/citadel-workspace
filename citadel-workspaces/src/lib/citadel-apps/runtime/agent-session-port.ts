/**
 * `citadel.session` (CW-6, citadel-session-abi): an app's C2S session to an external Citadel
 * server, held by the member's local agent under an account the agent owns. The page never dials
 * anything: it asks the agent with `AppSessionOpen` / `AppSessionSend` / `AppSessionClose`, and
 * reads `AppSessionState` / `AppSessionMessage` / `AppSessionFailure` for this member's session
 * and this install only. The rules (host/session-rules.ts) are decided before the agent is asked,
 * so a server outside the manifest is refused with nothing sent.
 *
 * What the agent reports unasked (a state change, a message) reaches the app as AppEvent
 * `session` for a session this instance opened; another instance's, or another install's, never.
 * An open's answer is the open's reply, not an event. Pure over the injected agent and clock.
 */
import type { OpArgs, OpReplies } from '../sdk/generated/AbiConstants';
import type { SessionState } from '../sdk/generated/SessionState';
import type { PortAnswer, Refused, SessionArrival, SessionPort } from '../host/ports';
import { SessionRules, type OpenDecision, type SessionGrant } from '../host/session-rules';
import { agentAsk, type AgentLink, type AgentOutcome, type Json } from './agent-link';
import { closeRequest, openRequest, readSessionWire, sendRequest, type SessionTarget, type SessionWire } from './agent-session-wire';

export interface SessionDeps extends SessionTarget {
  readonly grant: SessionGrant;
  /** How long the agent may take to answer an open (it may register and sign in first) or a close. */
  readonly timeoutMs: number;
  readonly nowMs: () => number;
  /** An agent refusal no call is waiting on (a send that failed after it was handed over). */
  readonly report: (what: string, detail: unknown) => void;
}

/** A session port with what its instance's end needs: close every session it still holds. */
export type OwnedSessionPort = SessionPort & { readonly closeAll: () => void };

const NO_AGENT: PortAnswer<never> = { refused: { unavailable: 'agent' } };

type Answer = Extract<SessionWire, { kind: 'state' | 'failure' }>;

export function agentSessionPort(link: AgentLink, d: SessionDeps): OwnedSessionPort {
  const rules: SessionRules = new SessionRules(d.grant);
  const listeners: Set<(a: SessionArrival) => void> = new Set<(a: SessionArrival) => void>();
  /** Opens in flight, by server: a second open of one waits for the first. */
  const dialing: Map<string, Promise<PortAnswer<SessionState>>> = new Map<string, Promise<PortAnswer<SessionState>>>();
  /** Requests whose answer a call is waiting on: their answers are replies, not events. */
  const asked: Set<string> = new Set<string>();
  const emit = (a: SessionArrival): void => { for (const l of [...listeners]) l(a); };

  const stop: () => void = link.listen((message: unknown): void => {
    const w: SessionWire | undefined = readSessionWire(message, d);
    if (w === undefined) return;
    if (w.kind === 'message') {
      if (rules.hears(w.session)) emit({ session: w.session, event: { message: { body: w.body } } });
      return;
    }
    if (w.requestId !== null && asked.has(w.requestId)) return;
    if (w.kind === 'failure') {
      d.report(`[apps] ${d.appId} (install ${d.installId}): the agent refused a session request`, w.refused);
      return;
    }
    if (rules.changed(w.session, w.state)) emit({ session: w.session, event: { state: { state: w.state } } });
  });

  const ask = async (build: (requestId: string) => Json): Promise<AgentOutcome<Answer>> => {
    let id: string | null = null;
    const got: AgentOutcome<Answer> = await agentAsk<Answer>(link, (requestId: string): Json => {
      id = requestId;
      asked.add(requestId);
      return build(requestId);
    }, (m: unknown, requestId: string): Answer | undefined => {
      const w: SessionWire | undefined = readSessionWire(m, d);
      return w !== undefined && w.kind !== 'message' && w.requestId === requestId ? w : undefined;
    }, d.timeoutMs);
    if (id !== null) asked.delete(id);
    return got;
  };

  const dial = async (server: string): Promise<PortAnswer<SessionState>> => {
    const got: AgentOutcome<Answer> = await ask(openRequest(d, server));
    if (!got.ok) return NO_AGENT;
    if (got.value.kind === 'failure') return { refused: got.value.refused };
    const state: SessionState = { session: got.value.session, cid: got.value.serverCid, state: got.value.state };
    rules.opened(server, state, d.nowMs());
    return { ok: state };
  };

  return {
    SessionOpen: ({ server }: OpArgs['SessionOpen']): PortAnswer<OpReplies['SessionOpen']> | Promise<PortAnswer<OpReplies['SessionOpen']>> => {
      const decision: OpenDecision = rules.open(server);
      if (decision.kind === 'refused') return { refused: decision.refused };
      if (decision.kind === 'existing') return { ok: decision.state };
      const inFlight: Promise<PortAnswer<SessionState>> | undefined = dialing.get(server);
      if (inFlight !== undefined) return inFlight;
      const opening: Promise<PortAnswer<SessionState>> = dial(server).finally((): void => { dialing.delete(server); });
      dialing.set(server, opening);
      return opening;
    },
    SessionSend: async ({ session, body }: OpArgs['SessionSend']): Promise<PortAnswer<null>> => {
      const refused: Refused | null = rules.send(session, body, d.nowMs());
      if (refused !== null) return { refused };
      // The agent answers a send only when it fails, so the reply is that the agent has it.
      return link.send(sendRequest(d, session, body)(link.newRequestId())).then((): PortAnswer<null> => ({ ok: null }), (): PortAnswer<null> => NO_AGENT);
    },
    SessionClose: async ({ session }: OpArgs['SessionClose']): Promise<PortAnswer<null>> => {
      const refused: Refused | null = rules.close(session);
      if (refused !== null) return { refused };
      const got: AgentOutcome<Answer> = await ask(closeRequest(d, session));
      if (!got.ok) return NO_AGENT;
      return got.value.kind === 'failure' ? { refused: got.value.refused } : { ok: null };
    },
    onEvent: (listener: (a: SessionArrival) => void): (() => void) => {
      listeners.add(listener);
      return (): void => { listeners.delete(listener); };
    },
    closeAll: (): void => {
      for (const session of rules.openSessions()) {
        rules.close(session);
        void link.send(closeRequest(d, session)(link.newRequestId())).catch((error: unknown): void => d.report(`[apps] ${d.appId}: closing session ${session} failed`, error));
      }
      listeners.clear();
      stop();
    },
  };
}
