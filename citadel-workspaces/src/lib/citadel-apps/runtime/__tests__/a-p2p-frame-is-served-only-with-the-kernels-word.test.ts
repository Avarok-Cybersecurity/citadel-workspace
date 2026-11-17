/**
 * The P2P port: the agent checks only a frame's shape, so the serving host asks the kernel
 * (`AuthorizePeer`) before any frame reaches the app, holds the answer at most 60 s, and refuses
 * every unauthorised case with the same Cancel. The agent is an in-memory AgentLink (the port's
 * one I/O boundary: it records sends and answers IhttpSend as accepted); the kernel's answer is an
 * injected function. The port, the cache and the wire translation are the production ones.
 */
import { describe, expect, it } from 'vitest';
import { decodeCbor, encodeCbor, type Decoded } from '../../host/cbor';
import { fromWireFrame, toWireFrame } from '../../host/ihttp-wire';
import type { IhttpPort, InboundIhttpFrame, PortAnswer } from '../../host/ports';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { PeerDirection } from 'citadel-workspace-client-ts';
import type { PeerAuthorization } from '../../member-consent-types';
import type { AgentLink } from '../agent-link';
import { p2pIhttpPort, p2pTable } from '../ihttp-p2p-port';
import { PeerAuthority } from '../peer-authority';
import { InstallPlaneRegistry } from '../install-plane-registry';

const APP: string = 'net.avarok.compute-pool';
const ME: bigint = 100n;
const ALICE: bigint = 200n;
const head = (stream: bigint): IhttpFrame => ({ v: 1, stream, kind: { RequestHead: { method: 'GET', path: '/health', query: '', headers: [], body_len: 0n, app_id: APP, scope_key: 'ws' } } });
const body = (stream: bigint): IhttpFrame => ({ v: 1, stream, kind: { Body: { bytes: new Uint8Array([1]) } } });

interface World {
  port: IhttpPort;
  delivered: InboundIhttpFrame[];
  sent: { peer: bigint; frame: IhttpFrame }[];
  asked: PeerDirection[];
  allow: { value: boolean };
  now: { ms: number };
  push: (cid: bigint, from: bigint, f: IhttpFrame) => Promise<void>;
  sendFailure: { value: string | null };
  /** What the page logged about each refusal: side and why. */
  refusals: string[];
  /** While true, the agent holds its answers to IhttpSend until `release` (one each). */
  hold: { value: boolean };
  release: () => void;
}

function world(): World {
  const handlers: Set<(m: unknown) => void> = new Set();
  const w: Partial<World> = { delivered: [], sent: [], asked: [], allow: { value: true }, now: { ms: 0 }, sendFailure: { value: null }, refusals: [], hold: { value: false } };
  const held: (() => void)[] = [];
  w.release = (): void => { held.shift()?.(); };
  let n: number = 0;
  const agent: AgentLink = {
    newRequestId: () => `req-${++n}`,
    listen: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: async (request: Record<string, unknown>) => {
      const s: { request_id: string; peer_cid: bigint; frame: number[] } = (request as { IhttpSend: { request_id: string; peer_cid: bigint; frame: number[] } }).IhttpSend;
      const decoded: Decoded = decodeCbor(Uint8Array.from(s.frame));
      w.sent!.push({ peer: s.peer_cid, frame: fromWireFrame(decoded.ok ? decoded.value : null) as IhttpFrame });
      const answer: Record<string, unknown> = w.sendFailure!.value === null
        ? { IhttpSendAccepted: { cid: ME, peer_cid: s.peer_cid, request_id: s.request_id } }
        : { IhttpSendFailure: { cid: ME, peer_cid: s.peer_cid, request_id: s.request_id, refusal: w.sendFailure!.value } };
      const answerIt = (): void => handlers.forEach((h) => h(answer));
      if (w.hold!.value) held.push(answerIt); else queueMicrotask(answerIt);
    },
  };
  const ask = async (peerCid: bigint, direction: PeerDirection): Promise<PeerAuthorization> => {
    w.asked!.push(direction);
    return w.allow!.value
      ? { ok: true, peer: { username: 'alice', cid: peerCid, app_id: APP, install_id: 'inst-1' }, untilMs: BigInt(w.now!.ms + 60_000) }
      : { ok: false, why: 'NoHost' };
  };
  const authority: PeerAuthority = new PeerAuthority(ask, () => w.now!.ms, 30);
  w.port = p2pIhttpPort({
    installId: 'inst-1', seat: new InstallPlaneRegistry().attach('inst-1', APP), appId: APP, cid: ME, agent, authority, timeoutMs: 1000,
    peerCid: (u: string) => (u === 'alice' ? ALICE : null),
    sha256Hex: async () => 'digest-1', p2pRoutes: ['GET /health'], maxRoutes: 64, maxPathBytes: 2048,
    noteRefusal: (peer: bigint, side: 'serve' | 'call', why: string): void => { w.refusals!.push(`${side} ${peer.toString()}: ${why}`); },
  });
  w.port.onFrame((i: InboundIhttpFrame) => w.delivered!.push(i));
  w.push = async (cid: bigint, from: bigint, f: IhttpFrame): Promise<void> => {
    handlers.forEach((h) => h({ IhttpFrameNotification: { cid, peer_cid: from, frame: Array.from(encodeCbor(toWireFrame(f))), request_id: null } }));
    await new Promise<void>((r) => setTimeout(r, 0));
  };
  return w as World;
}

const serving = async (): Promise<World> => {
  const w: World = world();
  await w.port.IhttpServe({ routes: [{ method: 'GET', path: '/health' }], on: { relay: false, p2p: true } });
  return w;
};

describe('serving over P2P', () => {
  it('an authorised caller’s request reaches the app, stamped by the kernel, never the frame', async () => {
    const w: World = await serving();
    await w.push(ME, ALICE, head(1n));
    expect(w.asked).toEqual([{ Serve: { routes_digest: 'digest-1' } }]);
    expect(w.delivered.map((d) => d.from)).toEqual([{ username: 'alice', cid: ALICE, app_id: APP, install_id: 'inst-1', via: 'p2p' }]);
  });

  it('a caller the kernel refuses is cancelled as `refused` and the app hears nothing', async () => {
    const w: World = await serving();
    w.allow.value = false;
    await w.push(ME, ALICE, head(1n));
    expect(w.delivered).toEqual([]);
    expect(w.sent).toEqual([{ peer: ALICE, frame: { v: 1, stream: 1n, kind: { Cancel: { reason: 'refused' } } } }]);
  });

  it('each refusal says why in this page’s log, while the peer hears only `refused`', async () => {
    const w: World = world();
    await w.push(ME, ALICE, head(1n));
    await w.port.IhttpServe({ routes: [{ method: 'GET', path: '/health' }], on: { relay: false, p2p: true } });
    await w.push(ME, ALICE, { ...head(2n), kind: { RequestHead: { method: 'GET', path: '/other', query: '', headers: [], body_len: 0n, app_id: APP, scope_key: 'ws' } } });
    w.allow.value = false;
    await w.push(ME, ALICE, head(3n));
    expect(w.refusals).toEqual([`serve ${ALICE}: not_serving`, `serve ${ALICE}: route`, `serve ${ALICE}: NoHost`]);
    expect(new Set(w.sent.map((s) => JSON.stringify(s.frame.kind)))).toEqual(new Set([JSON.stringify({ Cancel: { reason: 'refused' } })]));
  });

  it('an instance that does not serve on P2P refuses without asking', async () => {
    const w: World = world();
    await w.push(ME, ALICE, head(1n));
    expect([w.asked, w.delivered.length, w.sent.length]).toEqual([[], 0, 1]);
  });

  it('a revocation ends a running stream once the held answer expires (control: within 60 s it flows)', async () => {
    const w: World = await serving();
    await w.push(ME, ALICE, head(1n));
    w.allow.value = false;
    w.now.ms = 59_000;
    await w.push(ME, ALICE, body(1n));
    expect(w.delivered.map((d) => Object.keys(d.frame.kind as object)[0])).toEqual(['RequestHead', 'Body']);
    w.now.ms = 61_000;
    await w.push(ME, ALICE, body(1n));
    expect(w.delivered.map((d) => Object.keys(d.frame.kind as object)[0])).toEqual(['RequestHead', 'Body', 'Cancel']);
    expect(w.sent.at(-1)?.frame.kind).toEqual({ Cancel: { reason: 'refused' } });
  });

  it('a frame for another session in this browser is not this port’s', async () => {
    const w: World = await serving();
    await w.push(999n, ALICE, head(1n));
    expect([w.asked.length, w.delivered.length]).toEqual([0, 0]);
  });
});

describe('the order frames leave in', () => {
  it('a response’s frames go out one at a time, each after the agent took the last (control: answered, the next goes)', async () => {
    // The agent runs each IhttpSend in its own task, so frames sent together can reach the peer out
    // of order: an End ahead of its last Body cut the body short (Compute Pool, "unreadable answer").
    const w: World = await serving();
    await w.push(ME, ALICE, head(1n));
    const from: InboundIhttpFrame['from'] = w.delivered[0].from;
    w.hold.value = true;
    const answers: Promise<unknown>[] = [
      Promise.resolve(w.port.respond(from, { v: 1, stream: 1n, kind: { ResponseHead: { status: 200, headers: [], body_len: 1n } } })),
      Promise.resolve(w.port.respond(from, body(1n))),
      Promise.resolve(w.port.respond(from, { v: 1, stream: 1n, kind: 'End' })),
    ];
    const kinds = (): string[] => w.sent.map((s) => (typeof s.frame.kind === 'string' ? s.frame.kind : Object.keys(s.frame.kind)[0]));
    const tick = async (): Promise<void> => { await new Promise<void>((r) => setTimeout(r, 0)); };
    await tick();
    expect(kinds()).toEqual(['ResponseHead']);
    w.release();
    await tick();
    expect(kinds()).toEqual(['ResponseHead', 'Body']);
    w.release();
    await tick();
    w.release();
    await Promise.all(answers);
    expect(kinds()).toEqual(['ResponseHead', 'Body', 'End']);
  });
});

describe('calling over P2P', () => {
  const to = { user: { app_id: APP, username: 'alice' } } as const;

  it('asks the kernel before the first frame and sends nothing when refused', async () => {
    const w: World = world();
    w.allow.value = false;
    expect(await w.port.IhttpCall({ to, frame: head(1n), transport: 'p2p' })).toEqual({ refused: { unavailable: 'refused' } });
    expect([w.asked, w.sent, w.refusals]).toEqual([['Call'], [], [`call ${ALICE}: NoHost`]]);
  });

  it('a peer whose agent never advertised internal HTTP is a refusal before opening', async () => {
    const w: World = world();
    w.sendFailure.value = 'NotAdvertised';
    const answer: PortAnswer<null> = await w.port.IhttpCall({ to, frame: head(1n), transport: 'p2p' });
    expect(answer).toEqual({ refused: { unavailable: 'p2p_not_advertised' } });
  });

  it('the server’s answer is delivered as the kernel stamped it; nobody without a P2P relationship is called', async () => {
    const w: World = world();
    expect(await w.port.IhttpCall({ to, frame: head(1n), transport: 'p2p' })).toEqual({ ok: null });
    await w.push(ME, ALICE, { v: 1, stream: 1n, kind: { ResponseHead: { status: 200, headers: [], body_len: 0n } } });
    expect(w.delivered.map((d) => d.from.username)).toEqual(['alice']);
    expect(await w.port.IhttpCall({ to: { user: { app_id: APP, username: 'mallory' } }, frame: head(2n), transport: 'p2p' })).toEqual({ refused: { unavailable: 'p2p_no_peer' } });
  });
});

describe('the held answer', () => {
  it('is asked once per peer per minute, never held past until_ms, and dropped on an install change', async () => {
    let asks: number = 0;
    const now: { ms: number } = { ms: 0 };
    const a: PeerAuthority = new PeerAuthority(async () => { asks++; return { ok: true, peer: { username: 'a', cid: 1n, app_id: APP, install_id: 'i' }, untilMs: BigInt(now.ms + 10_000) }; }, () => now.ms, 30);
    await a.authorize(1n, 'Call');
    await a.authorize(1n, 'Call');
    expect(asks).toBe(1);
    now.ms = 10_001;
    await a.authorize(1n, 'Call');
    expect(asks).toBe(2);
    a.evictAll();
    await a.authorize(1n, 'Call');
    expect(asks).toBe(3);
  });

  it('a flood of uncached asks is limited before the kernel sees it', async () => {
    let asks: number = 0;
    const a: PeerAuthority = new PeerAuthority(async () => { asks++; return { ok: false, why: 'NoHost' }; }, () => 0, 2);
    // Three directions, so no held refusal answers in the limiter's place.
    const answers: unknown[] = [await a.authorize(1n, 'Call'), await a.authorize(1n, { Topic: { topic: 'pool' } }), await a.authorize(1n, { Serve: { routes_digest: 'd' } })];
    expect([asks, answers[2]]).toEqual([2, 'limited']);
  });
});

describe('the P2P table', () => {
  it('is the served routes consented for P2P, and nothing when the app served fewer than were consented', () => {
    const served = [{ method: 'GET', path: '/health' }, { method: 'POST', path: '/admin' }] as const;
    expect(p2pTable([...served], ['GET /health'])).toEqual([{ method: 'GET', path: '/health' }]);
    expect(p2pTable([served[1]], ['GET /health'])).toBeNull();
  });

  it('a P2P request for a relay-only route is refused before the kernel is asked', async () => {
    const w: World = world();
    await w.port.IhttpServe({ routes: [{ method: 'GET', path: '/health' }, { method: 'GET', path: '/relay-only' }], on: { relay: true, p2p: true } });
    const relayOnly: IhttpFrame = { v: 1, stream: 1n, kind: { RequestHead: { method: 'GET', path: '/relay-only', query: '', headers: [], body_len: 0n, app_id: APP, scope_key: 'ws' } } };
    await w.push(ME, ALICE, relayOnly);
    expect([w.asked, w.delivered.length, w.sent.map((s) => s.frame.kind)]).toEqual([[], 0, [{ Cancel: { reason: 'refused' } }]]);
  });

  it('serving fewer routes than were consented is ungranted on P2P', async () => {
    const w: World = world();
    expect(await w.port.IhttpServe({ routes: [{ method: 'GET', path: '/other' }], on: { relay: false, p2p: true } })).toEqual({ refused: 'ungranted' });
  });
});
