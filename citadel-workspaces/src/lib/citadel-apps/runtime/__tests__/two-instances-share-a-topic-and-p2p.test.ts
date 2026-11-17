/**
 * Two instances of one install on one page share one session (S5, S10, E9). A topic is joined
 * once and left only when the last of them closes, so closing one zone does not take the other
 * out of the group; one of them answers join requests. On P2P only one of them takes a request,
 * and a request for an app nobody here runs is refused once, exactly as an unauthorised one is.
 * The agent is an in-memory AgentLink (the ports' one I/O boundary) and the kernel an injected
 * answer; the ports, the registry and the codecs are the production ones.
 */
import { describe, expect, it } from 'vitest';
import { decodeCbor, encodeCbor, type Decoded } from '../../host/cbor';
import { fromWireFrame, toWireFrame } from '../../host/ihttp-wire';
import type { IhttpPort, InboundIhttpFrame, TopicArrival } from '../../host/ports';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { PeerAuthorization } from '../../member-consent-types';
import type { AgentLink } from '../agent-link';
import { InstallPlaneRegistry, type PlaneSeat } from '../install-plane-registry';
import { p2pIhttpPort } from '../ihttp-p2p-port';
import { PeerAuthority } from '../peer-authority';
import { encodeTopicMessage } from '../topic-model';
import { topicPort, type OwnedTopicPort } from '../topic-port';

const APP: string = 'net.avarok.compute-pool';
const ME: bigint = 100n;
const PEER: bigint = 8n;
const GROUP: Readonly<{ cid: bigint; mgid: bigint }> = { cid: 5n, mgid: 9n };
const SUCCESS: Readonly<Record<string, string>> = {
  GroupRequestJoin: 'GroupRequestJoinSuccess', GroupLeave: 'GroupLeaveSuccess', GroupRespondRequest: 'GroupRespondRequestSuccess', IhttpSend: 'IhttpSendAccepted',
};

interface TestAgent { link: AgentLink; sent: Record<string, Record<string, unknown>>[]; push: (m: unknown) => Promise<void> }

/** One session's agent, every request answered with its Success. */
function agent(): TestAgent {
  const handlers: Set<(m: unknown) => void> = new Set();
  const sent: Record<string, Record<string, unknown>>[] = [];
  let n: number = 0;
  const link: AgentLink = {
    newRequestId: () => `req-${++n}`,
    listen: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: async (request: Record<string, unknown>) => {
      const [variant, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
      sent.push({ [variant]: body });
      queueMicrotask(() => handlers.forEach((h) => h({ [SUCCESS[variant]]: { cid: ME, request_id: body.request_id, group_key: body.group_key, peer_cid: body.peer_cid } })));
    },
  };
  return { link, sent, push: async (m: unknown): Promise<void> => { handlers.forEach((h) => h(m)); await new Promise<void>((r) => setTimeout(r, 0)); } };
}

const admit = async (peerCid: bigint): Promise<PeerAuthorization> => ({ ok: true, peer: { username: 'alice', cid: peerCid, app_id: APP, install_id: 'inst-a' }, untilMs: 60_000n });
const variants = (sent: Record<string, Record<string, unknown>>[]): string[] => sent.map((s) => Object.keys(s)[0]);

function topics(seat: PlaneSeat, link: AgentLink, arrivals: TopicArrival[]): OwnedTopicPort {
  const port: OwnedTopicPort = topicPort({
    seat, cid: ME, agent: link, topics: ['pool'], limits: { max_msg_bytes: 64, max_msgs_per_s: 2 }, timeoutMs: 1000,
    authority: new PeerAuthority(admit, () => 0, 30), topicGroup: async () => '5:9',
    record: { group: () => undefined, request: () => undefined }, refused: () => undefined,
  });
  port.onEvent((a: TopicArrival) => arrivals.push(a));
  return port;
}

const message: Readonly<Record<string, unknown>> = { GroupMessageNotification: { cid: ME, peer_cid: PEER, group_key: GROUP, message: Array.from(encodeTopicMessage('pool', new Uint8Array([4]))), request_id: null } };

describe('a topic held by two instances of one install', () => {
  it('is joined once, still reaches the second after the first closes, and is left only when both have', async () => {
    const a: TestAgent = agent();
    const registry: InstallPlaneRegistry = new InstallPlaneRegistry();
    const heard: TopicArrival[][] = [[], []];
    const ports: OwnedTopicPort[] = [0, 1].map((i: number) => topics(registry.attach('inst-1', APP), a.link, heard[i]));
    await ports[0].TopicOpen({ name: 'pool' });
    await ports[1].TopicOpen({ name: 'pool' });
    expect(variants(a.sent)).toEqual(['GroupRequestJoin']);
    await ports[0].closeAll();
    expect(variants(a.sent)).toEqual(['GroupRequestJoin']);
    await a.push(message);
    expect([heard[0].length, heard[1].length]).toEqual([0, 1]);
    await ports[1].closeAll();
    expect(variants(a.sent)).toEqual(['GroupRequestJoin', 'GroupLeave']);
  });

  it('one of them answers a join request', async () => {
    const a: TestAgent = agent();
    const registry: InstallPlaneRegistry = new InstallPlaneRegistry();
    const ports: OwnedTopicPort[] = [0, 1].map(() => topics(registry.attach('inst-1', APP), a.link, []));
    await ports[0].TopicOpen({ name: 'pool' });
    await ports[1].TopicOpen({ name: 'pool' });
    await a.push({ GroupJoinRequestNotification: { cid: ME, peer_cid: PEER, group_key: GROUP, request_id: null } });
    expect(variants(a.sent).filter((v: string) => v === 'GroupRespondRequest')).toHaveLength(1);
  });
});

const head = (appId: string, stream: bigint): IhttpFrame => ({ v: 1, stream, kind: { RequestHead: { method: 'GET', path: '/health', query: '', headers: [], body_len: 0n, app_id: appId, scope_key: 'ws' } } });

interface P2pPage { push: (f: IhttpFrame) => Promise<void>; delivered: number[]; cancels: () => string[] }

async function p2pPage(instances: number, allow: boolean): Promise<P2pPage> {
  const a: TestAgent = agent();
  const registry: InstallPlaneRegistry = new InstallPlaneRegistry();
  const delivered: number[] = Array.from({ length: instances }, () => 0);
  const ask = async (peerCid: bigint): Promise<PeerAuthorization> => (allow ? admit(peerCid) : { ok: false, why: 'NoHost' });
  for (let i: number = 0; i < instances; i++) {
    const port: IhttpPort = p2pIhttpPort({
      installId: 'inst-1', seat: registry.attach('inst-1', APP), appId: APP, cid: ME, agent: a.link, authority: new PeerAuthority(ask, () => 0, 30),
      timeoutMs: 1000, peerCid: () => PEER, sha256Hex: async () => 'digest', p2pRoutes: ['GET /health'], maxRoutes: 64, maxPathBytes: 2048, noteRefusal: () => undefined,
    });
    await port.IhttpServe({ routes: [{ method: 'GET', path: '/health' }], on: { relay: false, p2p: true } });
    port.onFrame((_i: InboundIhttpFrame) => { delivered[i] += 1; });
  }
  const cancels = (): string[] => a.sent.flatMap((s) => {
    const send: { frame: number[] } | undefined = (s as { IhttpSend?: { frame: number[] } }).IhttpSend;
    if (send === undefined) return [];
    const d: Decoded = decodeCbor(Uint8Array.from(send.frame));
    const kind: IhttpFrame['kind'] = (fromWireFrame(d.ok ? d.value : null) as IhttpFrame).kind;
    return typeof kind === 'object' && 'Cancel' in kind ? [kind.Cancel.reason] : [];
  });
  const push = (f: IhttpFrame): Promise<void> => a.push({ IhttpFrameNotification: { cid: ME, peer_cid: PEER, frame: Array.from(encodeCbor(toWireFrame(f))), request_id: null } });
  return { push, delivered, cancels };
}

describe('P2P with two instances of one install', () => {
  it('a request is served by one instance and the other sends nothing', async () => {
    const page: P2pPage = await p2pPage(2, true);
    await page.push(head(APP, 1n));
    expect([page.delivered, page.cancels()]).toEqual([[1, 0], []]);
  });

  it('a request for an app nobody here runs is refused once, as an unauthorised one is', async () => {
    const foreign: P2pPage = await p2pPage(2, true);
    await foreign.push(head('com.other.app', 1n));
    const unauthorised: P2pPage = await p2pPage(1, false);
    await unauthorised.push(head(APP, 1n));
    expect(foreign.cancels()).toEqual(['refused']);
    expect(foreign.cancels()).toEqual(unauthorised.cancels());
  });
});
