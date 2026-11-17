/**
 * Removes ambient authority from a worker's global scope before any app code is instantiated
 * (design 2.3). Belt and braces: a core wasm module reaches nothing but its import object, which
 * is the actual guarantee. This makes sure a host bug cannot hand it a live `fetch` either.
 *
 * Each name is deleted wherever it lives on the prototype chain and then pinned on the scope
 * itself as a non-writable, non-configurable `undefined`, so it cannot be restored by assignment
 * or redefinition. The scope's own `postMessage` is removed too: the worker keeps the channel it
 * captured first (`captureChannel`) and nothing else can post anywhere.
 */
import type { FromWorker, WorkerChannel } from './worker-protocol';

export const AMBIENT_AUTHORITY: readonly string[] = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts',
  'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'RTCPeerConnection',
  'Notification', 'FileSystemHandle', 'navigator', 'postMessage', 'onmessage', 'Request', 'Response',
];

export interface ScrubbedScope {
  [name: string]: unknown;
}

function removeEverywhere(scope: object, name: string): void {
  let owner: object | null = scope;
  while (owner !== null) {
    const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(owner, name);
    if (desc !== undefined && desc.configurable === true) Reflect.deleteProperty(owner, name);
    owner = Object.getPrototypeOf(owner) as object | null;
  }
}

/** Scrubs `scope`; returns the names still reachable as something other than undefined. */
export function scrubAmbientAuthority(scope: object, names: readonly string[]): string[] {
  for (const name of names) {
    removeEverywhere(scope, name);
    try {
      Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false, enumerable: false });
    } catch {
      // An own non-configurable property that survived deletion: reported below.
    }
  }
  return names.filter((name: string) => (scope as ScrubbedScope)[name] !== undefined);
}

interface ChannelScope {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

/** Binds the scope's own channel before the scrub removes `postMessage` from it. */
export function captureChannel(scope: ChannelScope): WorkerChannel {
  const post: (message: FromWorker) => void = scope.postMessage.bind(scope);
  const add: ChannelScope['addEventListener'] = scope.addEventListener.bind(scope);
  return {
    post,
    listen: (handler: (message: unknown) => void): void => add('message', (event: MessageEvent<unknown>): void => handler(event.data)),
  };
}
