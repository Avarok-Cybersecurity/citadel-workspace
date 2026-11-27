/**
 * photo-decoder.ts against a fake worker and hand-driven timers: every photo is answered, by the
 * worker or by a refusal, and the worker (with the memory its module grew to) is ended when idle,
 * at a deadline, after an error event, and after a failure inside the module.
 */
import { describe, it, expect } from 'vitest';
import { createPhotoDecoder, type PhotoAnswer, type PhotoDecoder, type PhotoWorker } from '../photo-decoder';
import type { PhotoRequest } from '../protocol';

class FakeWorker implements PhotoWorker {
  readonly sent: PhotoRequest[] = [];
  terminated: boolean = false;
  private readonly listeners: Map<string, ((event: MessageEvent<unknown> | ErrorEvent) => void)[]> = new Map();
  postMessage(message: PhotoRequest): void { this.sent.push(message); }
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent<unknown> | ErrorEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  terminate(): void { this.terminated = true; }
  reply(id: number, answer: PhotoAnswer): void {
    for (const l of this.listeners.get('message') ?? []) l(new MessageEvent('message', { data: { id, answer } }));
  }
  fail(message: string): void {
    for (const l of this.listeners.get('error') ?? []) l(new ErrorEvent('error', { message }));
  }
}

class Clock {
  private timers: Map<number, { at: number; run: () => void }> = new Map();
  private now: number = 0;
  private next: number = 1;
  set = (run: () => void, ms: number): number => { const id: number = this.next++; this.timers.set(id, { at: this.now + ms, run }); return id; };
  clear = (id: number): void => { this.timers.delete(id); };
  advance(ms: number): void {
    this.now += ms;
    for (const [id, t] of [...this.timers]) if (t.at <= this.now) { this.timers.delete(id); t.run(); }
  }
}

function setup(): { decoder: PhotoDecoder; workers: FakeWorker[]; clock: Clock } {
  const workers: FakeWorker[] = [];
  const clock: Clock = new Clock();
  const decoder: PhotoDecoder = createPhotoDecoder({
    spawn: (): PhotoWorker => { const w: FakeWorker = new FakeWorker(); workers.push(w); return w; },
    limits: { maxPixels: 100, maxEdge: 10 },
    deadlineMs: 1000,
    idleMs: 500,
    timers: { set: clock.set, clear: clock.clear },
  });
  return { decoder, workers, clock };
}

const DONE: PhotoAnswer = { kind: 'decoded', blob: null, width: 4, height: 4 };

describe('the photo decoder', () => {
  it('starts no worker until a photo comes, then sends it with the limits', async () => {
    const { decoder, workers } = setup();
    expect(workers).toHaveLength(0);
    const pending: Promise<PhotoAnswer> = decoder.decode(new Uint8Array([7]), 'image/heic');
    expect(workers[0].sent[0]).toMatchObject({ id: 1, mime: 'image/heic', limits: { maxPixels: 100, maxEdge: 10 } });
    workers[0].reply(1, DONE);
    expect(await pending).toEqual(DONE);
  });

  it('ends the worker once it has been idle, and starts a fresh one for the next photo', async () => {
    const { decoder, workers, clock } = setup();
    const first: Promise<PhotoAnswer> = decoder.decode(new Uint8Array([1]), 'image/tiff');
    workers[0].reply(1, DONE);
    await first;
    clock.advance(499);
    expect(workers[0].terminated).toBe(false);
    clock.advance(1);
    expect(workers[0].terminated).toBe(true);
    void decoder.decode(new Uint8Array([2]), 'image/tiff');
    expect(workers).toHaveLength(2);
  });

  it('refuses a photo past its deadline and ends the decode', async () => {
    const { decoder, workers, clock } = setup();
    const slow: Promise<PhotoAnswer> = decoder.decode(new Uint8Array([1]), 'image/heic');
    clock.advance(1000);
    expect(await slow).toEqual({ kind: 'decoder-failed', detail: 'it took longer than 1 s' });
    expect(workers[0].terminated).toBe(true);
  });

  it('refuses every waiting photo when the worker fails to start', async () => {
    const { decoder, workers } = setup();
    const a: Promise<PhotoAnswer> = decoder.decode(new Uint8Array([1]), 'image/heic');
    const b: Promise<PhotoAnswer> = decoder.decode(new Uint8Array([2]), 'image/heic');
    workers[0].fail('glue failed to load');
    expect(await a).toEqual({ kind: 'decoder-failed', detail: 'glue failed to load' });
    expect(await b).toEqual({ kind: 'decoder-failed', detail: 'glue failed to load' });
  });

  it('starts afresh after a failure inside the module', async () => {
    const { decoder, workers } = setup();
    const a: Promise<PhotoAnswer> = decoder.decode(new Uint8Array([1]), 'image/heic');
    const b: Promise<PhotoAnswer> = decoder.decode(new Uint8Array([2]), 'image/heic');
    workers[0].reply(1, { kind: 'decoder-failed', detail: 'unreachable' });
    expect(await a).toEqual({ kind: 'decoder-failed', detail: 'unreachable' });
    expect(await b).toEqual({ kind: 'decoder-failed', detail: 'the decoder stopped after an error' });
    expect(workers[0].terminated).toBe(true);
    void decoder.decode(new Uint8Array([3]), 'image/heic');
    expect(workers).toHaveLength(2);
  });

  it('ignores a message that is not an answer', async () => {
    const { decoder, workers } = setup();
    const pending: Promise<PhotoAnswer> = decoder.decode(new Uint8Array([1]), 'image/heic');
    workers[0].reply(1, { kind: 'nonsense' } as unknown as PhotoAnswer);
    workers[0].reply(1, DONE);
    expect(await pending).toEqual(DONE);
  });
});
