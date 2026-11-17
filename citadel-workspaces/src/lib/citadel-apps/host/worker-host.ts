/**
 * The worker side of an app instance: instantiates the module with ONLY the built imports and
 * runs its exports, one message at a time. app-host.worker.ts wires it to the real (scrubbed)
 * worker scope; tests wire it to an in-process channel or a node worker thread.
 *
 * Guest code is never re-entered: events the host raises while the guest is inside a host call
 * (a router Cancel, a reply that became ready) queue and are delivered after the export returns.
 * Any exception out of an export is a trap: the worker reports `trapped` and runs nothing more.
 *
 * It mirrors the instance's lifecycle (lifecycle.ts), and the imports answer by it first: a
 * closing app reaches only storage and log. Close, in order: every internal-HTTP stream is
 * cancelled (`closed`), app_close runs (`closing`), and once no reply it waits on is pending and
 * nothing is queued for it, `settled`; nothing of the guest runs after that.
 */
import { CLOSE_REASON_CODE, CLOSE_RESULT, PAGE_BYTES } from '../sdk/generated/AbiConstants';
import type { CloseReason } from '../sdk/generated/CloseReason';
import { ABI_ERROR, INIT_RESULT } from './abi';
import { encodeAppEvent } from './app-event';
import type { CborMap } from './cbor';
import { effectiveGrant, type Capability } from './capabilities';
import { canvasPort, type CanvasSurface } from './canvas-port';
import { Dispatcher, isPortAnswer, type DispatchClock, type PortInvoker } from './dispatch';
import { IhttpRouter, type ClosingAction, type RouterAction } from './ihttp-router';
import { TopicGate } from './topic-sender';
import { buildImports } from './imports';
import { splitInvoker } from './invoker';
import { Lifecycle, lifecycleRefusal } from './lifecycle';
import type { OpEntry } from './ops';
import type { HostPorts, LogPort, PortAnswer, PortKey } from './ports';
import { ReplyTable } from './reply-table';
import { bindGuest, withBytes, type Guest } from './worker-guest';
import type { LoadMessage, ToWorker, WorkerChannel } from './worker-protocol';
import { isToWorker } from './worker-protocol';

/** Answered in the worker: the canvas it owns, and log (which also tells the page). */
const LOCAL_PORTS: ReadonlySet<PortKey | 'host'> = new Set<PortKey | 'host'>(['canvas', 'log', 'host']);
const ROUTER_TICK_MS: number = 1000;

/** Surfaces for an attached OffscreenCanvas; the worker entry passes the real `getContext`. */
export type SurfaceOf = (canvas: OffscreenCanvas, dpr: number) => CanvasSurface | null;

export function startWorkerHost(channel: WorkerChannel, clock: DispatchClock, surfaceOf: SurfaceOf): void {
  let guest: Guest | null = null;
  let dead: boolean = false;
  let canvas: OffscreenCanvas | null = null;
  let surface: CanvasSurface | null = null;
  let router: IhttpRouter | null = null;
  let replies: ReplyTable | null = null;
  let memoryPages: number = 0;
  let nextCall: number = 0;
  let selfSeq: number = 0;
  const life: Lifecycle = new Lifecycle();
  const waiting: Map<number, (answer: PortAnswer) => void> = new Map<number, (answer: PortAnswer) => void>();
  const queue: Uint8Array[] = [];

  const remote: PortInvoker = {
    invoke: (entry: OpEntry, args: CborMap): Promise<PortAnswer> => new Promise<PortAnswer>((resolve: (a: PortAnswer) => void): void => {
      const id: number = ++nextCall;
      waiting.set(id, resolve);
      channel.post({ kind: 'port_call', id, group: entry.group, op: entry.op, args });
    }),
  };

  const logToPage: LogPort = {
    LogWrite: ({ level, message }) => {
      channel.post({ kind: 'log', level, message });
      return { ok: null };
    },
  };

  const trap = (seq: number, error: unknown): void => {
    dead = true;
    life.abort();
    const message: string = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    channel.post({ kind: 'trapped', seq, message, memoryPages: guest === null ? memoryPages : guest.memory.buffer.byteLength / PAGE_BYTES });
  };

  const deliver = (g: Guest, bytes: Uint8Array): void => withBytes(g, bytes, g.event);

  /** Runs guest code, then every event it queued; false if it trapped. */
  const run = (seq: number, body: (g: Guest) => void): boolean => {
    if (dead || guest === null) return false;
    try {
      body(guest);
      while (queue.length > 0) deliver(guest, queue.shift() as Uint8Array);
      return true;
    } catch (error: unknown) {
      trap(seq, error);
      return false;
    }
  };

  /** A closing instance is settled once nothing it waits on is pending and nothing is queued for it. */
  const settleIfDone = (): void => {
    if (dead || queue.length > 0 || (replies?.pendingCount ?? 0) > 0 || !life.step('settled')) return;
    dead = true;
    channel.post({ kind: 'settled' });
  };

  const closingActions = (actions: readonly ClosingAction[]): void => {
    for (const a of actions) {
      if (a.kind === 'reply') channel.post({ kind: 'ihttp_out', peer: a.peer, frame: a.frame });
      else channel.post({ kind: 'ihttp_call_out', to: a.to, frame: a.frame, transport: a.transport });
    }
  };

  const routerActions = (actions: readonly RouterAction[]): void => {
    for (const a of actions) {
      if (a.kind === 'deliver') queue.push(encodeAppEvent({ ihttp: { from: a.peer, frame: a.frame } }));
      else closingActions([a]);
    }
  };

  /**
   * Delivers queued events outside any message (a reply that became ready, a stream deadline).
   * Worker-initiated, so it announces itself with `busy` and the handle's watchdog times it too.
   */
  const drainSoon = (): void => {
    clock.after(0, (): void => {
      if (dead || guest === null || queue.length === 0) return;
      const seq: number = --selfSeq;
      channel.post({ kind: 'busy', seq });
      if (run(seq, () => {})) channel.post({ kind: 'done', seq });
      settleIfDone();
    });
  };

  const tick = (): void => {
    if (dead) return;
    replies?.sweep();
    if (router !== null && router.liveStreams > 0) {
      routerActions(router.tick(clock.now()));
      drainSoon();
    }
    settleIfDone();
    clock.after(ROUTER_TICK_MS, tick);
  };

  const load = (msg: LoadMessage): void => {
    const granted: ReadonlySet<Capability> = effectiveGrant(new Set<Capability>(msg.granted));
    const memory: WebAssembly.Memory = new WebAssembly.Memory({ initial: msg.memory.initialPages, maximum: msg.memory.maxPages });
    memoryPages = memory.buffer.byteLength / PAGE_BYTES;
    const table: ReplyTable = new ReplyTable(msg.policy.maxLiveReplies, msg.policy.replyTtlMs, clock.now);
    replies = table;
    router = new IhttpRouter(msg.appId, msg.policy.ihttp, msg.limits.p2p);
    const local: HostPorts = { canvas: canvasPort(() => surface), ...(msg.hasLogPort ? { log: logToPage } : {}) };
    const invoker: PortInvoker = splitInvoker(local, LOCAL_PORTS, remote);
    const topics: TopicGate | null = msg.limits.topics === null ? null : new TopicGate(msg.limits.topics);
    const dispatcher: Dispatcher = new Dispatcher({ granted, policy: msg.policy, clock, invoker, router, pageUrl: msg.pageUrl, routerActions, topics });
    const imports: WebAssembly.Imports = buildImports(granted, memory, {
      call: (group, op, request) => dispatcher.call(group, op, request),
      replies: table,
      replyReady: (handle: number): void => {
        queue.push(encodeAppEvent({ reply_ready: { handle } }));
        drainSoon();
      },
      gate: (group) => lifecycleRefusal(life.state, group),
    });
    try {
      guest = bindGuest(new WebAssembly.Instance(msg.module, imports), memory);
    } catch (error: unknown) {
      trap(msg.seq, error);
      return;
    }
    let status: number = ABI_ERROR.BAD_REQUEST;
    if (!run(msg.seq, (g: Guest): void => {
      status = withBytes(g, msg.context, g.init);
    })) return;
    if (status !== INIT_RESULT.OK || !life.step('initialised')) dead = true;
    channel.post({ kind: 'loaded', seq: msg.seq, status });
    clock.after(ROUTER_TICK_MS, tick);
  };

  const close = (reason: CloseReason): void => {
    if (dead || guest === null || !life.step('close')) return;
    if (router !== null) closingActions(router.closeAll());
    let result: number = CLOSE_RESULT.NOT_RUNNING;
    if (!run(--selfSeq, (g: Guest): void => {
      result = g.close(CLOSE_REASON_CODE[reason]);
    })) return;
    channel.post({ kind: 'closing', result });
    settleIfDone();
  };

  const resize = (seq: number, width: number, height: number, dpr: number): void => {
    if (canvas !== null) {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      surface = surfaceOf(canvas, dpr);
    }
    const alive: boolean = life.state === 'running' || life.state === 'suspended';
    if (!alive || run(seq, (g: Guest) => deliver(g, encodeAppEvent({ resize: { width, height, dpr } })))) channel.post({ kind: 'done', seq });
  };

  const handle = (msg: ToWorker): void => {
    switch (msg.kind) {
      case 'load':
        if (guest === null && !dead) load(msg);
        return;
      case 'canvas':
        canvas = msg.canvas;
        surface = surfaceOf(msg.canvas, msg.dpr);
        return;
      case 'event':
        if (msg.step !== null && !life.step(msg.step)) channel.post({ kind: 'done', seq: msg.seq });
        else if (run(msg.seq, (g: Guest) => deliver(g, msg.event))) channel.post({ kind: 'done', seq: msg.seq });
        return;
      case 'frame':
        if (life.state !== 'running' || run(msg.seq, (g: Guest) => g.frame?.(msg.dtMs))) channel.post({ kind: 'done', seq: msg.seq });
        return;
      case 'resize': resize(msg.seq, msg.width, msg.height, msg.dpr); return;
      case 'close': close(msg.reason); return;
      case 'port_reply': {
        const resolve: ((a: PortAnswer) => void) | undefined = waiting.get(msg.id);
        waiting.delete(msg.id);
        resolve?.(isPortAnswer(msg.answer) ? msg.answer : { refused: { unavailable: 'port_answer' } });
        return;
      }
      case 'ihttp':
        if (router !== null) routerActions(router.inbound(msg.peer, msg.frame, clock.now()));
        if (run(msg.seq, () => {})) channel.post({ kind: 'done', seq: msg.seq });
        return;
    }
  };

  channel.listen((message: unknown): void => {
    if (isToWorker(message)) handle(message);
  });
}
