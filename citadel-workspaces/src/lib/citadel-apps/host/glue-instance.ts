/**
 * A first-party app on the glue ABI (`wasm-bindgen-glue-firstparty`, design 3.2) runs in the page
 * rather than in a worker, but it is still an install, and its calls are gated by the very
 * Dispatcher a worker's are (dispatch.ts): the same op table and argument check, the same
 * `admits()` against the grant its install holds for this member, the same request size, call
 * rates, timeouts, topic gate and internal-HTTP stream router (ihttp-router.ts). The kernel
 * re-checks it again. Nothing reaches a port the grant does not cover.
 *
 * The app's arguments cross as CBOR exactly as a worker's do, so the gate sees the bytes it would
 * see from a worker and the reply comes back as it would be read there.
 *
 * One difference, by design: a worker that outruns the server-call rate is refused and must
 * cope; the glue instance instead waits its turn. It keeps a second bucket of the policy's own
 * rate on the same clock, and a server call takes a token from it before it is dispatched, so the
 * Dispatcher's bucket always has one too and the rate it enforces is unchanged.
 *
 * What a worker hears as AppEvents the glue app subscribes to: `storage_changed` for its install
 * (runtime/storage-changed.ts), its topics' arrivals, and the inbound internal-HTTP frames the
 * router delivers.
 */
import type { OpArgs, OpReplies } from '../sdk/generated/AbiConstants';
import type { StorageBackend } from '../sdk/generated/StorageBackend';
import type { AbiGroup } from './abi';
import { decodeCbor, encodeCbor, type CborMap, type Decoded } from './cbor';
import { effectiveGrant, type Capability } from './capabilities';
import { Dispatcher, isPortAnswer, type DispatchClock, type DispatchOutcome } from './dispatch';
import type { ClosingAction, RouterAction } from './ihttp-common';
import { IhttpRouter } from './ihttp-router';
import { directInvoker } from './invoker';
import type { HostPolicy, InstanceLimits } from './limits';
import type { OpName } from './op-args';
import { findOp, findOpByName, type OpEntry } from './ops';
import type { HostPorts, HostReply, InboundIhttpFrame, TopicArrival } from './ports';
import { TokenBucket } from './token-bucket';
import { TopicGate } from './topic-sender';

export type Unsubscribe = () => void;

/** One key that changed in a store this install reads (AppEvent `storage_changed`). */
export interface StorageChange {
  readonly backend: StorageBackend;
  readonly key: string;
}

/** Where the install's StorageChanged pushes come from (bound to its install id by the mount). */
export type StorageChanges = (listener: (change: StorageChange) => void) => Unsubscribe;

export interface GlueOptions {
  readonly appId: string;
  readonly ports: HostPorts;
  /** What the install holds for this member: its grant less what they did not consent to. */
  readonly held: ReadonlySet<Capability>;
  readonly policy: HostPolicy;
  readonly limits: InstanceLimits;
  readonly clock: DispatchClock;
  /** The page the app is mounted in: what an internal link is relative to. */
  readonly pageUrl: string;
  readonly storageChanges: StorageChanges;
}

export interface GlueInstance {
  readonly held: ReadonlySet<Capability>;
  /** The clock the instance was given: what the app reads "now" from, and waits on. */
  readonly clock: DispatchClock;
  /** One call by (group, op), as a worker would make it. */
  readonly call: (group: AbiGroup, op: number, args: CborMap) => Promise<HostReply<unknown>>;
  /** The same call by the op's generated name, typed by its arguments and reply. */
  readonly op: <N extends OpName>(name: N, args: OpArgs[N]) => Promise<HostReply<OpReplies[N]>>;
  readonly onStorageChanged: (listener: (change: StorageChange) => void) => Unsubscribe;
  /** Arrivals on the topics this instance opened; nothing arrives without a topic port. */
  readonly onTopic: (listener: (arrival: TopicArrival) => void) => Unsubscribe;
  /** Inbound internal-HTTP frames the router admitted for this instance. */
  readonly onIhttp: (listener: (inbound: InboundIhttpFrame) => void) => Unsubscribe;
  /** Cancels every stream it serves or called and stops listening; calls after it are refused. */
  readonly close: () => void;
}

/** How often open streams are swept for deadlines, as a worker's router is (worker-host.ts). */
const ROUTER_TICK_MS: number = 1000;
const NOTHING: Unsubscribe = (): void => {};

function answerOf(bytes: Uint8Array): HostReply<unknown> {
  const decoded: Decoded = decodeCbor(bytes);
  return decoded.ok && isPortAnswer(decoded.value) ? (decoded.value as HostReply<unknown>) : { refused: { unavailable: 'host_error' } };
}

export function glueInstance(o: GlueOptions): GlueInstance {
  const { ports, clock } = o;
  const router: IhttpRouter = new IhttpRouter(o.appId, o.policy.ihttp, o.limits.p2p);
  const delivered: Set<(inbound: InboundIhttpFrame) => void> = new Set();
  let closed: boolean = false;

  const send = (actions: readonly ClosingAction[]): void => {
    for (const a of actions) {
      if (a.kind === 'reply') void ports.ihttp?.respond(a.peer, a.frame);
      else void ports.ihttp?.IhttpCall({ to: a.to, frame: a.frame, transport: a.transport });
    }
  };
  const routerActions = (actions: readonly RouterAction[]): void => {
    for (const a of actions) {
      if (a.kind === 'deliver') for (const listener of delivered) listener({ from: a.peer, frame: a.frame });
      else send([a]);
    }
  };
  const dispatcher: Dispatcher = new Dispatcher({
    granted: effectiveGrant(o.held), policy: o.policy, clock, invoker: directInvoker(ports), router, pageUrl: o.pageUrl, routerActions,
    topics: o.limits.topics === null ? null : new TopicGate(o.limits.topics),
  });

  const offInbound: Unsubscribe = ports.ihttp?.onFrame((inbound: InboundIhttpFrame): void => {
    if (!closed) routerActions(router.inbound(inbound.from, inbound.frame, clock.now()));
  }) ?? NOTHING;
  let stopTick: Unsubscribe = NOTHING;
  const tick = (): void => {
    if (closed) return;
    if (router.liveStreams > 0) routerActions(router.tick(clock.now()));
    stopTick = clock.after(ROUTER_TICK_MS, tick);
  };
  stopTick = clock.after(ROUTER_TICK_MS, tick);

  const pace: TokenBucket = new TokenBucket(o.policy.serverCallsPerSecond, clock.now());
  const tokenMs: number = Math.ceil(1000 / o.policy.serverCallsPerSecond);
  let queue: Promise<void> = Promise.resolve();
  /** Resolves when a server call may go: in the order they were made, one token each. */
  const turn = (): Promise<void> => {
    const mine: Promise<void> = queue.then(() => new Promise<void>((go: () => void): void => {
      const attempt = (): void => {
        if (closed || pace.take(clock.now())) go();
        else clock.after(tokenMs, attempt);
      };
      attempt();
    }));
    queue = mine;
    return mine;
  };

  const call = async (group: AbiGroup, op: number, args: CborMap): Promise<HostReply<unknown>> => {
    const entry: OpEntry | undefined = findOp(group, op);
    if (!closed && entry !== undefined && entry.server(args)) await turn();
    if (closed) return { refused: { unavailable: 'closed' } };
    const outcome: DispatchOutcome = dispatcher.call(group, op, encodeCbor(args));
    return answerOf('now' in outcome ? outcome.now : await outcome.later);
  };

  return {
    held: o.held,
    clock,
    call,
    op: async <N extends OpName>(name: N, args: OpArgs[N]): Promise<HostReply<OpReplies[N]>> => {
      const at: { readonly group: AbiGroup; readonly op: number } = findOpByName(name);
      return (await call(at.group, at.op, args as unknown as CborMap)) as HostReply<OpReplies[N]>;
    },
    onStorageChanged: o.storageChanges,
    onTopic: (listener: (arrival: TopicArrival) => void): Unsubscribe => ports.topic?.onEvent(listener) ?? NOTHING,
    onIhttp: (listener: (inbound: InboundIhttpFrame) => void): Unsubscribe => {
      delivered.add(listener);
      return (): void => { delivered.delete(listener); };
    },
    close: (): void => {
      if (closed) return;
      closed = true;
      stopTick();
      offInbound();
      delivered.clear();
      send(router.closeAll());
    },
  };
}
