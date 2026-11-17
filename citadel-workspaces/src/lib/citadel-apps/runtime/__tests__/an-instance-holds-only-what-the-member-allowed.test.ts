/**
 * The peer planes one instance is given (peer-ports.ts): it holds the install's grant less what
 * this member has not allowed; without an agent session there is no P2P plane and no topic; with
 * one, a P2P call asks the kernel once per minute per peer, and a change to an install or an
 * answer drops what was held. The kernel is an in-memory AppsTransport that answers AuthorizePeer
 * and TopicGroup, the agent an in-memory AgentLink that accepts every send; the ports are real.
 */
import { describe, expect, it } from 'vitest';
import type { AppInstall, AppLimits, AppsRequest, Capability, PeerForMe } from 'citadel-workspace-client-ts';
import { installOf } from '@/test/app-manifests';
import { readAppsAnswer, type AppsAnswer } from '../../wire/apps-answer';
import type { AppsTransport } from '@/lib/workspace-service/apps-operations';
import { STANDARD_HOST_POLICY } from '../../host/limits';
import type { IhttpPort, PortAnswer } from '../../host/ports';
import type { AgentLink } from '../agent-link';
import { peerPorts, type PeerPorts, type PeerWorld } from '../peer-ports';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import { InstallPlaneRegistry } from '../install-plane-registry';

const GRANTED: Capability[] = ['ihttp.p2p.serve', 'ihttp.p2p.call', 'group.topic.publish', 'storage.user'];
const INSTALL: AppInstall = installOf('com.acme.kanban', 'Workspace', {
  id: 'i-1', granted: GRANTED, details: { host_network_hosts: [], server_network_hosts: [], ihttp_routes: [], ihttp_call_targets: [], ihttp_p2p_routes: [], topics: ['pool'] },
});
// Only limits.topics is read by the peer planes; the rest of AppLimits is the manifest's and not under test.
/** The install is workspace-scoped (zone-context.ts `scopeKeyOf`). */
const SCOPE_KEY: string = 'workspace';
const LIMITS: AppLimits = { topics: { max_msg_bytes: 64, max_msgs_per_s: 2 } } as unknown as AppLimits;
const relay: IhttpPort = {
  IhttpServe: async () => ({ ok: null }), IhttpCall: async () => ({ refused: { unavailable: 'relay' } }),
  respond: async () => ({ ok: null }), onFrame: () => () => undefined,
} as unknown as IhttpPort;

interface World { w: PeerWorld; asked: AppsRequest[]; push: (a: unknown) => void }

function world(session: boolean, mine: PeerForMe | null): World {
  const asked: AppsRequest[] = [];
  const pushed: Set<(a: unknown) => void> = new Set();
  const transport: AppsTransport = {
    request: async (request: AppsRequest, isOurs) => {
      asked.push(request);
      const raw: unknown = typeof request === 'object' && 'AuthorizePeer' in request
        ? { PeerAuthorized: { install_id: 'i-1', peer: { username: 'bob', cid: request.AuthorizePeer.peer_cid, app_id: 'com.acme.kanban', install_id: 'i-2' }, direction: 'Call', until_ms: 10n ** 13n } }
        : { TopicGroup: { install_id: 'i-1', topic: 'pool', group_key: '5:9' } };
      const answer: AppsAnswer = readAppsAnswer(raw);
      if (!isOurs(answer)) throw new Error('not ours');
      return answer;
    },
  };
  const handlers: Set<(m: unknown) => void> = new Set();
  const agent: AgentLink = {
    newRequestId: () => `r-${asked.length}-${handlers.size}-${Math.random()}`,
    listen: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: async (r: Record<string, unknown>) => {
      const [variant, body] = Object.entries(r)[0] as [string, Record<string, unknown>];
      const reply: Record<string, unknown> = variant === 'IhttpSend'
        ? { IhttpSendAccepted: { cid: 100n, peer_cid: body.peer_cid, request_id: body.request_id } }
        : { GroupRequestJoinSuccess: { cid: 100n, group_key: body.group_key, request_id: body.request_id } };
      queueMicrotask(() => handlers.forEach((h) => h(reply)));
    },
  };
  const w: PeerWorld = {
    transport, agent, agentSession: session ? { cid: 100n } : null, sha256Hex: async () => 'd', nowMs: () => 0, policy: STANDARD_HOST_POLICY,
    pushes: (l) => { pushed.add(l); return () => pushed.delete(l); },
    peerCid: (u: string) => (u === 'bob' ? 200n : null), peerForMe: () => mine,
    topicRecord: { group: () => undefined, request: () => undefined }, report: () => undefined,
  };
  return { w, asked, push: (a: unknown): void => pushed.forEach((l) => l(a)) };
}

const head = (stream: bigint): IhttpFrame => ({ v: 1, stream, kind: { RequestHead: { method: 'GET', path: '/h', query: '', headers: [], body_len: 0n, app_id: 'com.acme.kanban', scope_key: 'ws' } } });
const call = async (p: IhttpPort, stream: bigint): Promise<PortAnswer<null>> =>
  await p.IhttpCall({ to: { user: { app_id: 'com.acme.kanban', username: 'bob' } }, frame: head(stream), transport: 'p2p' } as never);
const consent = (serve: boolean, callAllowed: boolean, topics: boolean): PeerForMe => ({ install_id: 'i-1', consent: { serve, call: callAllowed, topics, at_ms: 1n }, blocked: [] });

describe('an instance’s peer planes', () => {
  it('hold the grant less what this member did not allow; unanswered allows none of them', () => {
    expect([...peerPorts(INSTALL, SCOPE_KEY, LIMITS, relay, new InstallPlaneRegistry().attach(INSTALL.id, INSTALL.app_id), world(true, consent(true, false, false)).w).held]).toEqual(['ihttp.p2p.serve', 'storage.user']);
    expect([...peerPorts(INSTALL, SCOPE_KEY, LIMITS, relay, new InstallPlaneRegistry().attach(INSTALL.id, INSTALL.app_id), world(true, null).w).held]).toEqual(['storage.user']);
  });

  it('without an agent session there is no P2P plane and no topic (control: with one, both)', async () => {
    const none: PeerPorts = peerPorts(INSTALL, SCOPE_KEY, LIMITS, relay, new InstallPlaneRegistry().attach(INSTALL.id, INSTALL.app_id), world(false, consent(true, true, true)).w);
    expect([none.topic, await call(none.ihttp, 1n)]).toEqual([null, { refused: { unavailable: 'p2p' } }]);
    const some: PeerPorts = peerPorts(INSTALL, SCOPE_KEY, LIMITS, relay, new InstallPlaneRegistry().attach(INSTALL.id, INSTALL.app_id), world(true, consent(true, true, true)).w);
    expect([some.topic !== null, await call(some.ihttp, 1n)]).toEqual([true, { ok: null }]);
  });

  it('asks the kernel once per peer while held, and again after an install or answer changes', async () => {
    const x: World = world(true, consent(true, true, true));
    const ports: PeerPorts = peerPorts(INSTALL, SCOPE_KEY, LIMITS, relay, new InstallPlaneRegistry().attach(INSTALL.id, INSTALL.app_id), x.w);
    await call(ports.ihttp, 1n);
    await call(ports.ihttp, 2n);
    const authorizations = (): number => x.asked.filter((r) => typeof r === 'object' && 'AuthorizePeer' in r).length;
    expect(authorizations()).toBe(1);
    x.push({ PeerConsentForMe: { install_id: 'i-1', consent: { serve: true, call: true, topics: true, at_ms: 2n } } });
    await call(ports.ihttp, 3n);
    expect(authorizations()).toBe(2);
    // Another member's change reaches this page only as the server's notice, which drops them too.
    x.push('PeerAnswersChanged');
    await call(ports.ihttp, 4n);
    x.push('InstallsChanged');
    await call(ports.ihttp, 5n);
    expect(authorizations()).toBe(4);
    await ports.stop();
  });

  it('a topic names its group through the kernel', async () => {
    const x: World = world(true, consent(false, false, true));
    const ports: PeerPorts = peerPorts(INSTALL, SCOPE_KEY, LIMITS, relay, new InstallPlaneRegistry().attach(INSTALL.id, INSTALL.app_id), x.w);
    expect(await ports.topic?.TopicOpen({ name: 'pool' })).toEqual({ ok: { name: 'pool', members: [] } });
    expect(x.asked).toEqual([{ TopicGroup: { install_id: 'i-1', topic: 'pool', claim: null } }]);
  });
});
