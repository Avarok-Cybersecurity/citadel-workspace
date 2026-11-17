/**
 * One host call, from the guest's request bytes to CBOR reply bytes, in the reference host's
 * order: the request size cap, the op lookup (`unknown_op`), the argument schema
 * (`bad_arguments`), the capability (`ungranted`), then the host's own gates (rate limits,
 * navigation, the ihttp router) and the port. Pure over an injected clock, invoker and router
 * sink. It NEVER throws: every failure is a reply the guest can read.
 *
 * Replies are `{ok: value}` or `{refused: Refused}` (generated `HostReply`).
 */
import type { AbiGroup } from './abi';
import { decodeCbor, encodeCbor, f32, isCborMap, type CborMap, type Decoded } from './cbor';
import type { Capability } from './capabilities';
import type { IhttpRouter, RouterAction, Verdict } from './ihttp-router';
import type { TopicGate } from './topic-sender';
import { servePlan, type ServePlan } from './ihttp-planes';
import { parseRoutes, type ParsedRoutes } from './ihttp-routes';
import type { HostPolicy } from './limits';
import { parseArgs, type OpName } from './op-args';
import { findOp, navigateTarget, type OpClock, type OpEntry } from './ops';
import type { PortAnswer, PortReply, Refused } from './ports';
import { TokenBucket } from './token-bucket';
import type { OpArgs } from '../sdk/generated/AbiConstants';

export type DispatchOutcome = { readonly now: Uint8Array } | { readonly later: Promise<Uint8Array> };

export interface DispatchClock {
  readonly now: () => number;
  /** Calls `fire` after `ms`; returns the cancel. */
  readonly after: (ms: number, fire: () => void) => () => void;
}

/** Carries an op to its port: directly (tests, the main thread) or across the worker boundary. */
export interface PortInvoker {
  readonly invoke: (entry: OpEntry, args: CborMap) => PortReply | undefined;
}

export interface DispatcherDeps {
  /** The effective grant (intrinsic + installed). */
  readonly granted: ReadonlySet<Capability>;
  readonly policy: HostPolicy;
  readonly clock: DispatchClock;
  readonly invoker: PortInvoker;
  readonly router: IhttpRouter;
  /** The page the app is mounted in: what an internal link is relative to. */
  readonly pageUrl: string;
  /** Frames the router decided on while gating a call (sent to peers, told to the app). */
  readonly routerActions: (actions: readonly RouterAction[]) => void;
  /** The manifest's topic limits, answered as the app publishes; null when it has no topics. */
  readonly topics: TopicGate | null;
}

const refused = (why: Refused): Uint8Array => encodeCbor({ refused: why });

/** Reply fields that are f32 on the Rust side (every other reply number is an integer). */
const REPLY_FLOATS: Partial<Record<OpName, readonly string[]>> = { CanvasMeasure: ['dpr'], MeasureText: ['width'] };

/** Some requested planes are advertised and one is not: the app hears `ungranted`, unless the port refused anyway. */
const partialServe = (answer: PortAnswer): PortAnswer => ('ok' in answer ? { refused: 'ungranted' } : answer);

export function isPortAnswer(value: unknown): value is PortAnswer {
  if (!isCborMap(value)) return false;
  const keys: string[] = Object.keys(value);
  return keys.length === 1 && (keys[0] === 'ok' || keys[0] === 'refused');
}

export class Dispatcher {
  private readonly hostBucket: TokenBucket;
  private readonly serverBucket: TokenBucket;

  constructor(private readonly deps: DispatcherDeps) {
    const now: number = deps.clock.now();
    this.hostBucket = new TokenBucket(deps.policy.hostCallsPerSecond, now);
    this.serverBucket = new TokenBucket(deps.policy.serverCallsPerSecond, now);
  }

  call(group: AbiGroup, op: number, request: Uint8Array): DispatchOutcome {
    try {
      return this.dispatch(group, op, request);
    } catch {
      return { now: refused({ unavailable: 'host_error' }) };
    }
  }

  private dispatch(group: AbiGroup, op: number, request: Uint8Array): DispatchOutcome {
    const { policy, clock, granted } = this.deps;
    if (request.byteLength > policy.maxRequestBytes) return { now: refused({ limit: 'request_bytes' }) };
    if (group === 'log' && request.byteLength > policy.maxLogBytes) return { now: refused({ limit: 'log_bytes' }) };
    const entry: OpEntry | undefined = findOp(group, op);
    if (entry === undefined) return { now: refused({ policy: 'unknown_op' }) };
    const decoded: Decoded = decodeCbor(request);
    const args: CborMap | null = decoded.ok ? parseArgs(entry.name, decoded.value) : null;
    if (args === null) return { now: refused({ policy: 'bad_arguments' }) };
    if (!entry.admits(args, granted)) return { now: refused('ungranted') };
    if (!this.hostBucket.take(clock.now())) return { now: refused({ limit: 'host_calls' }) };
    if (entry.server(args) && !this.serverBucket.take(clock.now())) return { now: refused({ limit: 'server_calls' }) };
    const gate: Refused | null = this.hostGate(entry, args);
    if (gate !== null) return { now: refused(gate) };
    // An advertisement reaches the port with only the planes held; asking for one not held is `ungranted` after.
    const serve: ServePlan | null = entry.name === 'IhttpServe' ? servePlan((args as unknown as OpArgs['IhttpServe']).on, granted) : null;
    let reply: PortReply | undefined;
    try {
      reply = this.deps.invoker.invoke(entry, serve?.kind === 'serve' ? { ...args, on: serve.on } : args);
    } catch {
      return { now: refused({ unavailable: 'port_failed' }) };
    }
    if (reply === undefined) return { now: refused({ unavailable: entry.port }) };
    if (serve?.kind === 'serve' && serve.partial) reply = Promise.resolve(reply).then(partialServe);
    if (!(reply instanceof Promise)) return { now: this.encodeAnswer(entry.name, reply) };
    return { later: this.bounded(entry.name, reply, this.timeoutFor(entry.clock)) };
  }

  /** What the host itself decides before any port: navigation and the ihttp router. */
  private hostGate(entry: OpEntry, args: CborMap): Refused | null {
    const { router, policy, clock, granted } = this.deps;
    const verdict = (v: Verdict): Refused | null => {
      if (v.actions.length > 0) this.deps.routerActions(v.actions);
      return v.ok ? null : v.refused;
    };
    switch (entry.name) {
      case 'NavigateOpen':
        // Classified here against the page's URL and again where the port lives: an external
        // link is refused before it leaves the worker.
        return navigateTarget((args as unknown as OpArgs['NavigateOpen']).href, this.deps.pageUrl) === null ? { policy: 'not_an_internal_link' } : null;
      case 'IhttpServe': {
        const parsed: ParsedRoutes = parseRoutes((args as unknown as OpArgs['IhttpServe']).routes, policy.ihttp.maxRoutes, policy.ihttp.maxPathBytes);
        if (!parsed.ok) return { policy: 'bad_routes' };
        const plan: ServePlan = servePlan((args as unknown as OpArgs['IhttpServe']).on, granted);
        if (plan.kind !== 'serve') return { policy: 'bad_arguments' };
        router.setRoutes(parsed.routes, plan.on);
        return null;
      }
      case 'IhttpRespond': {
        const a: OpArgs['IhttpRespond'] = args as unknown as OpArgs['IhttpRespond'];
        return verdict(router.respond(a.peer, a.frame, clock.now()));
      }
      case 'IhttpCall': {
        const a: OpArgs['IhttpCall'] = args as unknown as OpArgs['IhttpCall'];
        return verdict(router.call(a.to, a.frame, a.transport, clock.now()));
      }
      case 'TopicPublish': {
        // Answered now, so a refused publish is the SDK's `Err`; the port, asynchronous, could only log it.
        const a: OpArgs['TopicPublish'] = args as unknown as OpArgs['TopicPublish'];
        return this.deps.topics === null ? null : this.deps.topics.admit(a.name, a.body, clock.now());
      }
      case 'IhttpConsumed': {
        const a: OpArgs['IhttpConsumed'] = args as unknown as OpArgs['IhttpConsumed'];
        return verdict(router.consumed(a.peer, a.stream, clock.now()));
      }
      default:
        return null;
    }
  }

  private timeoutFor(clock: OpClock): number {
    const { policy } = this.deps;
    if (clock === 'host_net') return policy.hostNetTimeoutMs;
    if (clock === 'server_net') return policy.serverNetTimeoutMs;
    return policy.portTimeoutMs;
  }

  private bounded(name: OpName, reply: Promise<PortAnswer>, ms: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve: (bytes: Uint8Array) => void): void => {
      let settled: boolean = false;
      const settle = (bytes: Uint8Array): void => {
        if (settled) return;
        settled = true;
        cancel();
        resolve(bytes);
      };
      const cancel: () => void = this.deps.clock.after(ms, (): void => settle(refused({ limit: 'timeout' })));
      reply.then(
        (answer: PortAnswer): void => settle(this.encodeAnswer(name, answer)),
        (): void => settle(refused({ unavailable: 'port_failed' })),
      );
    });
  }

  private encodeAnswer(name: OpName, answer: unknown): Uint8Array {
    if (!isPortAnswer(answer)) return refused({ unavailable: 'port_answer' });
    let bytes: Uint8Array;
    try {
      bytes = encodeCbor(withFloats(answer, REPLY_FLOATS[name]));
    } catch {
      return refused({ unavailable: 'port_answer' });
    }
    return bytes.byteLength > this.deps.policy.maxReplyBytes ? refused({ limit: 'reply_bytes' }) : bytes;
  }
}

/** `{ok: {...}}` with the named top-level fields of the ok value written as CBOR floats. */
function withFloats(answer: PortAnswer, fields: readonly string[] | undefined): unknown {
  if (fields === undefined || !('ok' in answer) || !isCborMap(answer.ok)) return answer;
  const ok: Record<string, unknown> = { ...answer.ok };
  for (const f of fields) if (typeof ok[f] === 'number') ok[f] = f32(ok[f] as number);
  return { ok };
}
