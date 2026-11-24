/**
 * `citadel.session` through the member's agent (citadel-session-abi §1, §3): the production
 * dispatcher, op table and session port, with the agent the only fake (FakeAgent records every
 * request and answers in the agent's wire shape, app_session.rs). A server outside the manifest
 * never reaches the agent; what the agent reports reaches only the instance of its install and
 * member session; `no_identity` comes back as its own refusal, so the guest can fall back.
 */
import { describe, expect, it } from 'vitest';
import { decodeCbor, encodeCbor, type Decoded } from '../../host/cbor';
import type { Capability } from '../../host/capabilities';
import { Dispatcher, type DispatchOutcome } from '../../host/dispatch';
import { IhttpRouter } from '../../host/ihttp-router';
import { directInvoker } from '../../host/invoker';
import { STANDARD_HOST_POLICY } from '../../host/limits';
import type { SessionArrival } from '../../host/ports';
import { ManualClock } from '../../host/__tests__/fakes';
import { agentSessionPort, type OwnedSessionPort, type SessionDeps } from '../agent-session-port';
import { bodyOf, FakeAgent, variantName } from './fake-agent';
import type { Json } from '../agent-link';

// The manifest's grant; small limits so they are reached in a few calls.
const DEPS: SessionDeps = {
  cid: 42n, appId: 'work.synchronized.app', installId: 'inst-1', actingUsername: 'alice',
  grant: { servers: ['synchronized.work'], limits: { max_msg_bytes: 8, max_msgs_per_s: 2 } },
  timeoutMs: 200, nowMs: (): number => 0, report: (): void => undefined,
};
const SESSION_OPEN: number = 1;
const SESSION_SEND: number = 2;
const SESSION_CLOSE: number = 3;

/** An agent that opens session 7 to whatever is asked, answering on the asker's cid and install. */
const opening = (r: Json): unknown[] => {
  if (variantName(r) !== 'AppSessionOpen') return [];
  const b: Json = bodyOf(r);
  return [{ AppSessionState: { cid: b.cid, request_id: b.request_id, install_id: b.install_id, session: 7, server_cid: 900n, state: 'connecting' } }];
};

function dispatcher(port: OwnedSessionPort): Dispatcher {
  return new Dispatcher({
    granted: new Set<Capability>(['citadel.session']), policy: STANDARD_HOST_POLICY, clock: new ManualClock(), invoker: directInvoker({ session: port }),
    router: new IhttpRouter(DEPS.appId, STANDARD_HOST_POLICY.ihttp, null), pageUrl: 'https://work.avarok.net/', routerActions: (): void => {}, topics: null,
  });
}

async function answer(outcome: DispatchOutcome): Promise<unknown> {
  const decoded: Decoded = decodeCbor('now' in outcome ? outcome.now : await outcome.later);
  if (!decoded.ok) throw new Error('reply is not CBOR');
  return decoded.value;
}

const open = (d: Dispatcher, server: string): Promise<unknown> => answer(d.call('session', SESSION_OPEN, encodeCbor({ server })));
const send = (d: Dispatcher, session: number, n: number): Promise<unknown> => answer(d.call('session', SESSION_SEND, encodeCbor({ session, body: new Uint8Array(n) })));
const settle = (): Promise<void> => new Promise((resolve: () => void): void => { setTimeout(resolve, 5); });

describe('opening a session', () => {
  it('a server the manifest does not name is ungranted, and the agent hears nothing (control: a named one reaches it)', async () => {
    const agent: FakeAgent = new FakeAgent(opening);
    const d: Dispatcher = dispatcher(agentSessionPort(agent, DEPS));
    expect(await open(d, 'evil.example')).toEqual({ refused: 'ungranted' });
    expect(agent.sent).toEqual([]);
    // `cid` (the agent-held account's, a u64) is a CBOR integer on the wire, which reads back small as a number.
    expect(await open(d, 'synchronized.work')).toEqual({ ok: { session: 7, cid: 900, state: 'connecting' } });
    expect(agent.sent).toEqual([{ AppSessionOpen: { request_id: 'req-1', cid: 42n, app_id: DEPS.appId, install_id: 'inst-1', acting_username: 'alice', server: 'synchronized.work' } }]);
  });

  it('a second open of the server returns the open session without asking again', async () => {
    const agent: FakeAgent = new FakeAgent(opening);
    const d: Dispatcher = dispatcher(agentSessionPort(agent, DEPS));
    const [first, second] = await Promise.all([open(d, 'synchronized.work'), open(d, 'synchronized.work')]);
    expect(second).toEqual(first);
    expect(await open(d, 'synchronized.work')).toEqual(first);
    expect(agent.sent).toHaveLength(1);
  });

  it('no_identity is its own refusal, apart from ungranted and from an agent that never answers', async () => {
    const noIdentity: FakeAgent = new FakeAgent((r: Json) => [{ AppSessionFailure: { cid: 42n, request_id: bodyOf(r).request_id, install_id: 'inst-1', reason: 'no_identity' } }]);
    expect(await open(dispatcher(agentSessionPort(noIdentity, DEPS)), 'synchronized.work')).toEqual({ refused: { unavailable: 'no_identity' } });
    const silent: FakeAgent = new FakeAgent(() => []);
    expect(await open(dispatcher(agentSessionPort(silent, DEPS)), 'synchronized.work')).toEqual({ refused: { unavailable: 'agent' } });
  });
});

describe('sending', () => {
  it('over max_msg_bytes or over the rate is refused now and never sent; within, the body goes to the agent as bytes', async () => {
    const agent: FakeAgent = new FakeAgent(opening);
    const d: Dispatcher = dispatcher(agentSessionPort(agent, DEPS));
    await open(d, 'synchronized.work');
    expect(await send(d, 7, 9)).toEqual({ refused: { limit: 'session_bytes' } });
    expect(await send(d, 8, 1)).toEqual({ refused: { policy: 'invalid' } });
    expect(await send(d, 7, 8)).toEqual({ ok: null });
    expect(await send(d, 7, 1)).toEqual({ ok: null });
    expect(await send(d, 7, 1)).toEqual({ refused: { limit: 'session_rate' } });
    const sends: Json[] = agent.sent.filter((r: Json) => variantName(r) === 'AppSessionSend');
    expect(sends.map((r: Json) => (bodyOf(r).body as number[]).length)).toEqual([8, 1]);
    expect(bodyOf(sends[0])).toMatchObject({ cid: 42n, install_id: 'inst-1', session: 7 });
  });
});

describe('what the agent reports', () => {
  const message = (cid: bigint, installId: string, session: number): Json =>
    ({ AppSessionMessage: { cid, request_id: undefined, install_id: installId, session, body: [1, 2] } });

  it('reaches only the instance of its install and member session that opened it', async () => {
    const agent: FakeAgent = new FakeAgent(opening);
    const mine: OwnedSessionPort = agentSessionPort(agent, DEPS);
    const otherInstall: OwnedSessionPort = agentSessionPort(agent, { ...DEPS, installId: 'inst-2' });
    const otherMember: OwnedSessionPort = agentSessionPort(agent, { ...DEPS, cid: 43n });
    const heard: Record<string, SessionArrival[]> = { mine: [], otherInstall: [], otherMember: [] };
    mine.onEvent((a: SessionArrival) => heard.mine.push(a));
    otherInstall.onEvent((a: SessionArrival) => heard.otherInstall.push(a));
    otherMember.onEvent((a: SessionArrival) => heard.otherMember.push(a));
    await open(dispatcher(mine), 'synchronized.work');
    for (const m of [message(42n, 'inst-1', 7), message(42n, 'inst-2', 7), message(43n, 'inst-1', 7), message(42n, 'inst-1', 8)]) agent.emitSoon(m);
    await settle();
    expect(heard.mine).toEqual([{ session: 7, event: { message: { body: Uint8Array.from([1, 2]) } } }]);
    expect(heard.otherInstall).toEqual([]);
    expect(heard.otherMember).toEqual([]);
  });

  it('a later state change is an event; the open’s own answer is its reply, not an event', async () => {
    const agent: FakeAgent = new FakeAgent(opening);
    const port: OwnedSessionPort = agentSessionPort(agent, DEPS);
    const heard: SessionArrival[] = [];
    port.onEvent((a: SessionArrival) => heard.push(a));
    await open(dispatcher(port), 'synchronized.work');
    await settle();
    expect(heard).toEqual([]);
    agent.emitSoon({ AppSessionState: { cid: 42n, request_id: undefined, install_id: 'inst-1', session: 7, server_cid: 900n, state: { closed: { reason: 'server_gone' } } } });
    await settle();
    expect(heard).toEqual([{ session: 7, event: { state: { state: { closed: { reason: 'server_gone' } } } } }]);
  });

  it('the close’s own answer is its reply, not an event to the app', async () => {
    const agent: FakeAgent = new FakeAgent((q: Json): unknown[] => variantName(q) === 'AppSessionOpen' ? opening(q) : [
      { AppSessionState: { cid: 42n, request_id: bodyOf(q).request_id, install_id: 'inst-1', session: 7, server_cid: 900n, state: { closed: { reason: 'closed_by_app' } } } },
    ]);
    const port: OwnedSessionPort = agentSessionPort(agent, DEPS);
    const heard: SessionArrival[] = [];
    port.onEvent((a: SessionArrival) => heard.push(a));
    const d: Dispatcher = dispatcher(port);
    await open(d, 'synchronized.work');
    expect(await answer(d.call('session', SESSION_CLOSE, encodeCbor({ session: 7 })))).toEqual({ ok: null });
    await settle();
    expect(agent.sent.map(variantName)).toEqual(['AppSessionOpen', 'AppSessionClose']);
    expect(heard).toEqual([]);
  });

  it('the instance’s end closes what it holds open and stops listening', async () => {
    const agent: FakeAgent = new FakeAgent(opening);
    const port: OwnedSessionPort = agentSessionPort(agent, DEPS);
    await open(dispatcher(port), 'synchronized.work');
    port.closeAll();
    expect(agent.sent.map(variantName)).toEqual(['AppSessionOpen', 'AppSessionClose']);
    expect(bodyOf(agent.sent[1])).toMatchObject({ cid: 42n, install_id: 'inst-1', session: 7 });
    expect(agent.listeners).toBe(0);
  });
});
