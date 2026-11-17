/**
 * Two instances of one install on one page, over the relay (S5, E9): a request is served by one
 * of them and the other never hears it (so it never Cancels it as unknown), a stream's later
 * frames reach the instance whose stream it is, the role passes on when the primary closes, and
 * their calls never share an id on the wire. The relay ports and the registry are the
 * production ones; the server is the in-memory `send`/`pushes` pair each port is given.
 */
import { describe, expect, it } from 'vitest';
import { decodeCbor, encodeCbor, type Decoded } from '../../host/cbor';
import { fromWireFrame, RELAY_STREAM_BIT, toWireFrame } from '../../host/ihttp-wire';
import type { InboundIhttpFrame } from '../../host/ports';
import type { Address } from '../../sdk/generated/Address';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { IhttpFrom } from 'citadel-workspace-client-ts';
import { InstallPlaneRegistry, type PlaneSeat } from '../install-plane-registry';
import { relayIhttpPort, type RelayIhttpPort } from '../ihttp-relay-port';

const APP: string = 'com.acme.kanban';
const FROM: IhttpFrom = { username: 'bob', cid: 7n, app_id: APP, install_id: 'inst-9' };
const head = (stream: bigint): IhttpFrame => ({ v: 1, stream, kind: { RequestHead: { method: 'GET', path: '/a', query: '', headers: [], body_len: 0n, app_id: APP, scope_key: 'ws' } } });
const end = (stream: bigint): IhttpFrame => ({ v: 1, stream, kind: 'End' });

interface Page {
  readonly ports: RelayIhttpPort[];
  readonly heard: InboundIhttpFrame[][];
  readonly sent: bigint[];
  readonly push: (f: IhttpFrame) => void;
  readonly detach: (i: number) => void;
}

function page(instances: number): Page {
  const registry: InstallPlaneRegistry = new InstallPlaneRegistry();
  const listeners: Set<(a: unknown) => void> = new Set();
  const sent: bigint[] = [];
  const seats: PlaneSeat[] = Array.from({ length: instances }, () => registry.attach('inst-1', APP));
  const ports: RelayIhttpPort[] = seats.map((seat) => relayIhttpPort({
    installId: 'inst-1', seat, sha256Hex: async () => 'd', nowMs: () => 0, every: () => () => undefined,
    send: async (_to, bytes) => { const d: Decoded = decodeCbor(bytes); sent.push((fromWireFrame(d.ok ? d.value : null) as IhttpFrame).stream); return { ok: true, value: null }; },
    advertise: async (_d, until) => ({ ok: true, value: until }), withdraw: async () => ({ ok: true, value: 0 }),
    pushes: (l) => { listeners.add(l); return () => listeners.delete(l); },
  }));
  const heard: InboundIhttpFrame[][] = ports.map(() => []);
  ports.forEach((p, i) => p.onFrame((f: InboundIhttpFrame) => heard[i].push(f)));
  const push = (f: IhttpFrame): void => {
    const answer: Readonly<Record<string, unknown>> = { IhttpFrame: { from: FROM, to_install_id: 'inst-1', frame: Array.from(encodeCbor(toWireFrame(f))) } };
    for (const l of [...listeners]) l(answer);
  };
  return { ports, heard, sent, push, detach: (i: number) => seats[i].detach() };
}

const counts = (p: Page): number[] => p.heard.map((h) => h.length);

describe('two instances of one install share the relay', () => {
  it('a request reaches one instance only, and its later frames the same one (control: a lone instance hears it all)', () => {
    const two: Page = page(2);
    two.push(head(RELAY_STREAM_BIT | 1n));
    two.push(end(RELAY_STREAM_BIT | 1n));
    expect(counts(two)).toEqual([2, 0]);
    const one: Page = page(1);
    one.push(head(RELAY_STREAM_BIT | 1n));
    expect(counts(one)).toEqual([1]);
  });

  it('when the primary closes, the next instance takes the requests', () => {
    const two: Page = page(2);
    two.detach(0);
    two.push(head(RELAY_STREAM_BIT | 2n));
    expect(counts(two)).toEqual([0, 1]);
  });

  it('their calls go out under distinct ids and come back to the instance that made each, under its own id', async () => {
    const two: Page = page(2);
    const to: Address = { user: { app_id: APP, username: 'bob' } };
    await two.ports[0].IhttpCall({ to, frame: head(1n), transport: 'relay' });
    await two.ports[1].IhttpCall({ to, frame: head(1n), transport: 'relay' });
    expect(two.sent).toEqual([1n, 2n]);
    two.push(end(2n));
    expect(two.heard[0]).toEqual([]);
    expect(two.heard[1].map((h) => [h.frame.stream, h.frame.kind])).toEqual([[1n, 'End']]);
  });
});
