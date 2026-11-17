/**
 * The main-thread handle of one app instance: owns its worker, carries the worker's port calls to
 * the injected ports (re-checked against the grant), runs the watchdog (instance-watchdog.ts), and
 * drives the instance's lifecycle (lifecycle.ts): start, suspend/resume, resize, close.
 *
 * Close (idempotent: every caller shares one outcome): the worker cancels its streams, runs
 * app_close and delivers the replies it waits on; the instance ends when it settles, the install's
 * close grace runs out or the app traps, whichever is first, and the worker is terminated and the
 * slot released in every case. Close never rejects.
 */
import type { AppEvent } from '../sdk/generated/AppEvent';
import type { CloseReason } from '../sdk/generated/CloseReason';
import type { SuspendReason } from '../sdk/generated/SuspendReason';
import { INIT_RESULT } from './abi';
import { encodeAppContext, encodeAppEvent } from './app-event';
import { IhttpInbox } from './ihttp-inbox';
import { PendingClose, type CloseEnding, type CloseOutcome } from './instance-close';
import type { LaunchOptions } from './instance-options';
import { Watchdog } from './instance-watchdog';
import { regrantedCall } from './invoker';
import { Lifecycle, type LifecycleState, type LifecycleStep } from './lifecycle';
import type { InboundIhttpFrame, PortAnswer, PortReply } from './ports';
import { isFromWorker, type FromWorker, type HostChannel, type ToWorker } from './worker-protocol';

export type { CloseEnding, CloseOutcome, LaunchOptions };

export type InstanceState =
  | 'loading' | 'running' | 'init-failed' | 'stopped-unresponsive' | 'stopped-trapped' | 'terminated' | 'closed';

export type Launch = { readonly ok: true; readonly instance: AppInstance } | { readonly ok: false; readonly reason: 'instance_limit' };

export function launchAppInstance(options: LaunchOptions): Launch {
  const release: (() => void) | null = options.slots.acquire();
  if (release === null) return { ok: false, reason: 'instance_limit' };
  return { ok: true, instance: new AppInstance(options, release) };
}

const STOPPED: ReadonlySet<InstanceState> = new Set<InstanceState>(['init-failed', 'stopped-unresponsive', 'stopped-trapped', 'terminated', 'closed']);
/** Where events other than frames may be delivered: the app exists and has not begun to close. */
const ALIVE: ReadonlySet<LifecycleState> = new Set<LifecycleState>(['initialised', 'running', 'suspended']);

export class AppInstance {
  private current: InstanceState = 'loading';
  private readonly life: Lifecycle = new Lifecycle();
  private readonly listeners: Set<(state: InstanceState) => void> = new Set<(state: InstanceState) => void>();
  private readonly watchdog: Watchdog;
  private nextSeq: number = 0;
  private readonly inbox: IhttpInbox;
  private closing: PendingClose | null = null;
  private readonly channel: HostChannel;
  /** Why the guest trapped, when it did. */
  trapMessage: string | null = null;
  /** The guest memory's size when it trapped, in 64 KiB pages. */
  trapMemoryPages: number | null = null;
  initStatus: number | null = null;

  constructor(private readonly options: LaunchOptions, private readonly release: () => void) {
    this.watchdog = new Watchdog(options.clock, options.policy.computeBudgetMs, (): void => this.stop('stopped-unresponsive', 'trapped'));
    this.channel = options.spawn();
    this.channel.addEventListener('message', (event: MessageEvent<unknown>): void => {
      if (isFromWorker(event.data)) this.onMessage(event.data);
    });
    this.inbox = new IhttpInbox(options.ports.ihttp, (inbound: InboundIhttpFrame): void => {
      if (!STOPPED.has(this.current) && ALIVE.has(this.life.state)) this.send({ kind: 'ihttp', seq: this.seq(), peer: inbound.from, frame: inbound.frame }, []);
    });
    this.send({
      kind: 'load', seq: this.seq(), module: options.module, appId: options.appId, granted: [...options.granted],
      memory: options.memory, context: encodeAppContext(options.context), policy: options.policy, limits: options.limits,
      pageUrl: options.pageUrl, hasLogPort: options.ports.log !== undefined,
    }, []);
  }

  get state(): InstanceState {
    return this.current;
  }

  get lifecycle(): LifecycleState {
    return this.life.state;
  }

  onState(listener: (state: InstanceState) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /** The start: AppEvent init. False when the lifecycle does not allow it from here. */
  start(): boolean {
    return this.lifecycleEvent('start', 'init');
  }

  suspend(reason: SuspendReason): boolean {
    return this.lifecycleEvent('suspend', { suspend: { reason } });
  }

  resume(): boolean {
    return this.lifecycleEvent('resume', 'resume');
  }

  /** One AppEvent (pointer, key, ...), CBOR-encoded for the guest, while the app is alive. */
  postEvent(event: AppEvent): void {
    if (STOPPED.has(this.current) || !ALIVE.has(this.life.state)) return;
    this.send({ kind: 'event', seq: this.seq(), event: encodeAppEvent(event), step: null }, []);
  }

  frame(dtMs: number): void {
    if (STOPPED.has(this.current) || this.life.state !== 'running') return;
    this.send({ kind: 'frame', seq: this.seq(), dtMs }, []);
  }

  /** The zone's new size in CSS px: the worker resizes the bitmap, then tells the app. */
  resize(width: number, height: number, dpr: number): void {
    if (STOPPED.has(this.current) || !ALIVE.has(this.life.state)) return;
    this.send({ kind: 'resize', seq: this.seq(), width, height, dpr }, []);
  }

  /** Transfers the canvas to the worker; the page keeps only the placeholder element. */
  attachCanvas(canvas: OffscreenCanvas, dpr: number): void {
    if (STOPPED.has(this.current)) return;
    this.channel.postMessage({ kind: 'canvas', canvas, dpr }, [canvas]);
  }

  close(reason: CloseReason): Promise<CloseOutcome> {
    if (this.closing !== null) return this.closing.outcome;
    const pending: PendingClose = new PendingClose(reason, this.options.clock);
    this.closing = pending;
    if (STOPPED.has(this.current)) pending.end('already-stopped');
    else if (!this.life.step('close')) this.stop('terminated', 'not-started');
    else {
      this.inbox.close();
      pending.arm(this.options.closeGraceMs, (): void => this.stop('terminated', 'grace-expired'));
      this.channel.postMessage({ kind: 'close', reason }, []);
    }
    return pending.outcome;
  }

  /** Ends the instance now, without closing it: none of the app's code runs again. */
  terminate(): void {
    this.stop('terminated', 'already-stopped');
  }

  private lifecycleEvent(step: LifecycleStep, event: AppEvent): boolean {
    if (STOPPED.has(this.current) || !this.life.step(step)) return false;
    this.send({ kind: 'event', seq: this.seq(), event: encodeAppEvent(event), step }, []);
    return true;
  }

  private seq(): number {
    return ++this.nextSeq;
  }

  private send(message: ToWorker, transfer: Transferable[]): void {
    if ('seq' in message) this.watchdog.begin(message.seq);
    this.channel.postMessage(message, transfer);
  }

  private onMessage(message: FromWorker): void {
    if (STOPPED.has(this.current)) return;
    switch (message.kind) {
      case 'busy': this.watchdog.begin(message.seq); return;
      case 'done': this.watchdog.finish(message.seq); return;
      case 'trapped':
        this.trapMessage = message.message;
        this.trapMemoryPages = message.memoryPages;
        this.stop('stopped-trapped', 'trapped');
        return;
      case 'loaded': this.loaded(message.seq, message.status); return;
      case 'port_call': this.portCall(message); return;
      case 'log': {
        // Already answered in the worker; a page LogPort that fails loses that one line, nothing else.
        const r: PortReply | undefined = this.options.ports.log?.LogWrite({ level: message.level, message: message.message });
        if (r instanceof Promise) r.catch((): void => undefined);
        return;
      }
      case 'ihttp_out': void this.options.ports.ihttp?.respond(message.peer, message.frame); return;
      case 'ihttp_call_out': void this.options.ports.ihttp?.IhttpCall({ to: message.to, frame: message.frame, transport: message.transport }); return;
      case 'closing': if (this.closing !== null) this.closing.closeResult = message.result; return;
      case 'settled':
        if (this.life.step('settled')) this.stop('closed', 'settled');
        return;
    }
  }

  private loaded(seq: number, status: number): void {
    this.watchdog.finish(seq);
    this.initStatus = status;
    if (status !== INIT_RESULT.OK || !this.life.step('initialised')) {
      this.stop('init-failed', 'not-started');
      return;
    }
    this.setState('running');
    this.inbox.open();
  }

  private portCall(message: Extract<FromWorker, { kind: 'port_call' }>): void {
    const answer = (a: PortAnswer): void => {
      if (!STOPPED.has(this.current)) this.channel.postMessage({ kind: 'port_reply', id: message.id, answer: a }, []);
    };
    let reply: PortReply;
    try {
      reply = regrantedCall(this.options.ports, this.options.granted, message.group, message.op, message.args);
    } catch {
      answer({ refused: { unavailable: 'port_failed' } });
      return;
    }
    if (reply instanceof Promise) reply.then(answer, (): void => answer({ refused: { unavailable: 'port_failed' } }));
    else answer(reply);
  }

  /** The one way an instance ends: the worker is terminated, the slot released, a close answered. */
  private stop(state: InstanceState, ending: CloseEnding): void {
    if (STOPPED.has(this.current)) return;
    this.watchdog.clear();
    this.inbox.close();
    if (state !== 'closed') this.life.abort();
    this.channel.terminate();
    this.release();
    this.setState(state);
    this.closing?.end(ending);
  }

  private setState(state: InstanceState): void {
    this.current = state;
    for (const listener of [...this.listeners]) listener(state);
  }
}
