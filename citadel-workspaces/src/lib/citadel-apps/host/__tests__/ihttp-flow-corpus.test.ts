/**
 * The shared internal-HTTP flow corpus (apps/catalogue/fixtures/ihttp-flow-cases.json),
 * through the page's IhttpRouter serving one stream: a caller's frame goes in as `inbound`
 * (a fault is the router cancelling the stream), the app's as `respond` (a fault is a refused
 * verdict). The kernel's StreamFlow reads the same file (ihttp_flow_corpus_tests.rs), and the
 * verdicts are written once, by hand, in the file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IhttpRouter, type RouterAction } from '../ihttp-router';
import { parseRoutes, type ParsedRoutes } from '../ihttp-routes';
import { STANDARD_IHTTP_LIMITS } from '../limits';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { RequestHead } from '../../sdk/generated/RequestHead';

interface Step {
  readonly from: 'client' | 'server';
  readonly kind: 'End' | 'Body' | 'Credit' | 'Cancel' | 'ResponseHead';
  readonly len?: number;
  readonly n?: number;
  readonly body_len?: number | null;
  readonly expect: 'ok' | 'fault';
}
interface FlowCase { readonly name: string; readonly body_len: number | null; readonly steps: readonly Step[] }

const CORPUS: string = join(process.cwd(), '..', 'apps', 'catalogue', 'fixtures', 'ihttp-flow-cases.json');
const cases: readonly FlowCase[] = (JSON.parse(readFileSync(CORPUS, 'utf8')) as { cases: FlowCase[] }).cases;

const APP: string = 'com.acme.kanban';
const STREAM: bigint = 1n;
const caller: Caller = { username: 'alice', cid: 11n, app_id: APP, install_id: 'i-1', via: 'relay' };

const big = (n: number | null | undefined): bigint | null => (n === null || n === undefined ? null : BigInt(n));
const head = (bodyLen: bigint | null): RequestHead => ({
  method: 'GET', path: '/cards', query: '', headers: [], body_len: bodyLen, app_id: APP, scope_key: 'workspace',
});

function kindOf(step: Step): IhttpFrame['kind'] {
  switch (step.kind) {
    case 'End': return 'End';
    case 'Body': return { Body: { bytes: new Uint8Array(step.len ?? 0) } };
    case 'Credit': return { Credit: { n: step.n ?? 0 } };
    case 'Cancel': return { Cancel: { reason: 'caller' } };
    case 'ResponseHead': return { ResponseHead: { status: 200, headers: [], body_len: big(step.body_len) } };
  }
}

const cancelled = (actions: readonly RouterAction[]): boolean => actions.some((a: RouterAction) =>
  a.kind === 'reply' && typeof a.frame.kind === 'object' && 'Cancel' in a.frame.kind);
const delivered = (actions: readonly RouterAction[]): boolean => actions.some((a: RouterAction) => a.kind === 'deliver');

/** A caller's frame: handed to the app, or the stream cancelled; anything else is neither. */
function inboundVerdict(actions: readonly RouterAction[]): string {
  if (cancelled(actions)) return 'fault';
  return delivered(actions) ? 'ok' : 'neither delivered nor refused';
}

function opened(bodyLen: bigint | null): IhttpRouter {
  const r: IhttpRouter = new IhttpRouter(APP, STANDARD_IHTTP_LIMITS, null);
  const parsed: ParsedRoutes = parseRoutes([{ method: 'GET', path: '/cards' }], 64, 2048);
  if (!parsed.ok) throw new Error(parsed.reason);
  r.setRoutes(parsed.routes, { relay: true, p2p: true });
  const at: RouterAction[] = r.inbound(caller, { v: 1, stream: STREAM, kind: { RequestHead: head(bodyLen) } }, 0);
  if (cancelled(at)) throw new Error('the head was refused');
  return r;
}

describe('the shared flow corpus, through the page router', () => {
  it('finds the corpus', () => {
    // A floor: without it the cases below pass by being none.
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(cases)('$name', (c: FlowCase) => {
    const r: IhttpRouter = opened(big(c.body_len));
    c.steps.forEach((step: Step, i: number) => {
      const f: IhttpFrame = { v: 1, stream: STREAM, kind: kindOf(step) };
      const verdict: string = step.from === 'client' ? inboundVerdict(r.inbound(caller, f, 0)) : r.respond(caller, f, 0).ok ? 'ok' : 'fault';
      expect(verdict, `step ${i}`).toBe(step.expect);
    });
  });
});
