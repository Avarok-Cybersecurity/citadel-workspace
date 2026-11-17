/**
 * The scrub against stand-in globals shaped like a worker scope: names on the prototype chain and
 * on the scope itself are removed and cannot be put back; an own non-configurable one is reported.
 * (real-worker.test.ts runs the production entry's scrub against a real thread's global.)
 */
import { describe, expect, it } from 'vitest';
import { AMBIENT_AUTHORITY, captureChannel, scrubAmbientAuthority, type ScrubbedScope } from '../scrub';
import type { FromWorker, WorkerChannel } from '../worker-protocol';

// A class per stand-in: the scrub deletes from the prototype, and a shared one would carry that
// deletion into whichever test runs next.
function standIn(): ScrubbedScope {
  class FakeWorkerGlobalScope {
    fetch(): string { return 'network'; }
    postMessage(m: FromWorker): FromWorker { return m; }
    addEventListener(): void {}
  }
  const scope: ScrubbedScope = Object.create(FakeWorkerGlobalScope.prototype) as ScrubbedScope;
  for (const name of ['XMLHttpRequest', 'WebSocket', 'indexedDB', 'caches', 'BroadcastChannel', 'EventSource', 'importScripts']) {
    Object.defineProperty(scope, name, { value: () => name, configurable: true, writable: true });
  }
  return scope;
}

describe('scrubAmbientAuthority', () => {
  it('removes every listed name, prototype or own, and reports none left', () => {
    const scope: ScrubbedScope = standIn();
    expect(typeof scope.fetch).toBe('function');
    expect(scrubAmbientAuthority(scope, AMBIENT_AUTHORITY)).toEqual([]);
    for (const name of AMBIENT_AUTHORITY) expect([name, scope[name]]).toEqual([name, undefined]);
  });

  it('a removed name cannot be restored by assignment or redefinition', () => {
    const scope: ScrubbedScope = standIn();
    scrubAmbientAuthority(scope, AMBIENT_AUTHORITY);
    expect(() => { 'use strict'; scope.fetch = (): string => 'again'; }).toThrow(TypeError);
    expect(() => Object.defineProperty(scope, 'fetch', { value: () => 'again' })).toThrow(TypeError);
    expect(scope.fetch).toBeUndefined();
  });

  it('reports a name it could not remove (own and non-configurable)', () => {
    const scope: ScrubbedScope = standIn();
    Object.defineProperty(scope, 'fetch', { value: () => 'pinned', configurable: false, writable: false });
    expect(scrubAmbientAuthority(scope, AMBIENT_AUTHORITY)).toEqual(['fetch']);
  });

  it('the channel captured before the scrub still posts; the scope itself no longer can', () => {
    const posted: FromWorker[] = [];
    const scope: ScrubbedScope & { postMessage(m: FromWorker): void; addEventListener(): void } = Object.assign(standIn(), {
      postMessage: (m: FromWorker): void => { posted.push(m); },
      addEventListener: (): void => {},
    }) as ScrubbedScope & { postMessage(m: FromWorker): void; addEventListener(): void };
    const channel: WorkerChannel = captureChannel(scope);
    scrubAmbientAuthority(scope, AMBIENT_AUTHORITY);
    channel.post({ kind: 'done', seq: 1 });
    expect(posted).toEqual([{ kind: 'done', seq: 1 }]);
    expect(scope.postMessage).toBeUndefined();
  });
});
