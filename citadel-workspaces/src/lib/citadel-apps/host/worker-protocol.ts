/**
 * The messages between an app instance's handle (main thread) and its worker. Every message that
 * makes the worker run guest code carries a `seq` and is answered by `done` with that seq (or by
 * `loaded`/`trapped`); guest code the worker runs on its own (a reply that became ready) is
 * bracketed by `busy` and `done`. The handle's watchdog times exactly those. The worker never receives a
 * MessagePort, and the only thing it posts to is this channel.
 */
import type { AbiGroup } from './abi';
import { isCborMap, type CborMap } from './cbor';
import type { Capability } from './capabilities';
import type { Address } from '../sdk/generated/Address';
import type { Caller } from '../sdk/generated/Caller';
import type { CloseReason } from '../sdk/generated/CloseReason';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { LifecycleStep } from '../sdk/generated/LifecycleStep';
import type { LogLevel } from '../sdk/generated/LogLevel';
import type { Transport } from '../sdk/generated/Transport';
import type { HostPolicy, InstanceLimits } from './limits';
import type { PortAnswer } from './ports';

export interface LoadMessage {
  readonly kind: 'load';
  readonly seq: number;
  readonly module: WebAssembly.Module;
  readonly appId: string;
  readonly granted: readonly Capability[];
  readonly memory: { readonly initialPages: number; readonly maxPages: number };
  /** CBOR AppContext, handed to app_init. */
  readonly context: Uint8Array;
  readonly policy: HostPolicy;
  readonly limits: InstanceLimits;
  /** The page's URL, which internal links are classified against. */
  readonly pageUrl: string;
  /** Whether the page injected a LogPort: log answers at once in the worker, so it must know. */
  readonly hasLogPort: boolean;
}

export type ToWorker =
  | LoadMessage
  /** `step`: the lifecycle step the event takes (init: start; suspend; resume), or null. */
  | { readonly kind: 'event'; readonly seq: number; readonly event: Uint8Array; readonly step: LifecycleStep | null }
  | { readonly kind: 'frame'; readonly seq: number; readonly dtMs: number }
  /** Runs no guest code itself: the reply reaches the guest in a later busy...done drain. */
  | { readonly kind: 'port_reply'; readonly id: number; readonly answer: PortAnswer }
  | { readonly kind: 'ihttp'; readonly seq: number; readonly peer: Caller; readonly frame: IhttpFrame }
  | { readonly kind: 'canvas'; readonly canvas: OffscreenCanvas; readonly dpr: number }
  /** The zone's new size in CSS px: the bitmap follows, then AppEvent resize. */
  | { readonly kind: 'resize'; readonly seq: number; readonly width: number; readonly height: number; readonly dpr: number }
  /** Runs app_close; `closing` answers when it returned, `settled` once nothing it waits on is left. */
  | { readonly kind: 'close'; readonly reason: CloseReason };

export type FromWorker =
  | { readonly kind: 'done'; readonly seq: number }
  /** The worker is about to run guest code on its own initiative (negative seq); `done` follows. */
  | { readonly kind: 'busy'; readonly seq: number }
  | { readonly kind: 'loaded'; readonly seq: number; readonly status: number }
  | { readonly kind: 'trapped'; readonly seq: number; readonly message: string; readonly memoryPages: number }
  /** A LogWrite the guest made; answered at once in the worker, carried to the page's LogPort. */
  | { readonly kind: 'log'; readonly level: LogLevel; readonly message: string }
  | { readonly kind: 'port_call'; readonly id: number; readonly group: AbiGroup; readonly op: number; readonly args: CborMap }
  | { readonly kind: 'ihttp_out'; readonly peer: Caller; readonly frame: IhttpFrame }
  /** A frame on a call whose server has not answered yet, so only its address is known. */
  | { readonly kind: 'ihttp_call_out'; readonly to: Address; readonly frame: IhttpFrame; readonly transport: Transport }
  | { readonly kind: 'closing'; readonly result: number }
  | { readonly kind: 'settled' };

const TO_WORKER: ReadonlySet<string> = new Set<ToWorker['kind']>(['load', 'event', 'frame', 'port_reply', 'ihttp', 'canvas', 'resize', 'close']);
const FROM_WORKER: ReadonlySet<string> = new Set<FromWorker['kind']>(['done', 'busy', 'loaded', 'trapped', 'log', 'port_call', 'ihttp_out', 'ihttp_call_out', 'closing', 'settled']);

export function isToWorker(value: unknown): value is ToWorker {
  return isCborMap(value) && typeof value.kind === 'string' && TO_WORKER.has(value.kind);
}

export function isFromWorker(value: unknown): value is FromWorker {
  return isCborMap(value) && typeof value.kind === 'string' && FROM_WORKER.has(value.kind);
}

/** The worker's end of the channel, captured before the scrub removes it from `self`. */
export interface WorkerChannel {
  readonly post: (message: FromWorker) => void;
  readonly listen: (handler: (message: unknown) => void) => void;
}

/** The handle's end: a Worker, or in tests anything with the same three methods. */
export interface HostChannel {
  postMessage(message: ToWorker, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  terminate(): void;
}
