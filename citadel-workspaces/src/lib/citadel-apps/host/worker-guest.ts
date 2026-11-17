/**
 * The guest as the worker host calls it: the module's exports, already past inspect.ts (so every
 * required one exists with its signature), and how bytes are handed in through app_alloc.
 */
import { inBounds } from './reply-table';

export interface Guest {
  readonly memory: WebAssembly.Memory;
  readonly alloc: (len: number) => number;
  readonly free: (ptr: number, len: number) => void;
  readonly init: (ptr: number, len: number) => number;
  readonly event: (ptr: number, len: number) => void;
  readonly frame: ((dtMs: number) => void) | null;
  readonly close: (reason: number) => number;
}

export function bindGuest(instance: WebAssembly.Instance, memory: WebAssembly.Memory): Guest {
  const x: WebAssembly.Exports = instance.exports;
  return {
    memory,
    alloc: x.app_alloc as Guest['alloc'],
    free: x.app_free as Guest['free'],
    init: x.app_init as Guest['init'],
    event: x.app_event as Guest['event'],
    frame: typeof x.app_frame === 'function' ? (x.app_frame as (dt: number) => void) : null,
    close: x.app_close as Guest['close'],
  };
}

/** Copies `bytes` into guest memory through app_alloc, runs `body` on them, frees; what `body` answered. */
export function withBytes<T>(g: Guest, bytes: Uint8Array, body: (ptr: number, len: number) => T): T {
  const ptr: number = g.alloc(bytes.byteLength) >>> 0;
  if (!inBounds(g.memory, ptr, bytes.byteLength)) throw new Error('app_alloc returned a pointer outside memory');
  new Uint8Array(g.memory.buffer, ptr, bytes.byteLength).set(bytes);
  const out: T = body(ptr, bytes.byteLength);
  g.free(ptr, bytes.byteLength);
  return out;
}
