/**
 * DocumentPictures over a memory port: every read verified against its id, one request per id,
 * a bounded number at once, and failures kept or retried by what they are.
 */
import { describe, expect, it } from 'vitest';
import { DocumentPictures } from '../document-pictures';
import { sha256ContentId } from '../content-id';
import type { PictureDocument, PictureResult } from '../picture-port';
import { memoryPictures, PNG_4X3, type MemoryPictures } from './doubles/memory-pictures';

const DOC: PictureDocument = { kind: 'page', nodeId: 'n' };

function pictures(port: MemoryPictures, clock: { t: number } = { t: 0 }, fetchConcurrency: number = 3): DocumentPictures {
  return new DocumentPictures({ port, doc: DOC, contentIdOf: sha256ContentId, now: (): number => clock.t, limits: { fetchConcurrency, retryAfterMs: 1000 } });
}

async function kept(store: MemoryPictures, bytes: Uint8Array): Promise<string> {
  const id: string = await sha256ContentId(bytes);
  expect((await pictures(store).keep(id, bytes)).ok).toBe(true);
  return id;
}

const variant = (n: number): Uint8Array => Uint8Array.from([...PNG_4X3, n]);

describe('DocumentPictures', () => {
  it('answers the bytes kept under an id', async () => {
    const store: MemoryPictures = memoryPictures();
    const id: string = await kept(store, PNG_4X3);
    expect(await pictures(store).fetch(id)).toEqual({ ok: true, value: PNG_4X3 });
  });

  it('refuses to keep bytes under an id that is not theirs', async () => {
    const store: MemoryPictures = memoryPictures();
    await expect(pictures(store).keep(await sha256ContentId(variant(1)), PNG_4X3)).rejects.toThrow(/are not that picture/);
    expect(store.puts).toEqual([]);
  });

  it('calls bytes that do not hash to the id damaged, and never hands them on', async () => {
    const store: MemoryPictures = memoryPictures();
    const id: string = await kept(store, PNG_4X3);
    store.tamper(id, variant(9));
    expect(await pictures(store).fetch(id)).toEqual({ ok: false, failure: { kind: 'damaged' } });
  });

  it('asks the store once for concurrent fetches of one id', async () => {
    const store: MemoryPictures = memoryPictures();
    const id: string = await kept(store, PNG_4X3);
    const p: DocumentPictures = pictures(store);
    const release: () => void = store.hold();
    const both: Promise<Array<PictureResult<Uint8Array> | null>> = Promise.all([p.fetch(id), p.fetch(id)]);
    release();
    const [a, b] = await both;
    expect(a).toEqual(b);
    expect(store.gets).toHaveLength(1);
  });

  it('runs at most fetchConcurrency fetches at once', async () => {
    const store: MemoryPictures = memoryPictures();
    const ids: string[] = [];
    for (let n: number = 0; n < 5; n++) ids.push(await kept(store, variant(n)));
    const p: DocumentPictures = pictures(store, { t: 0 }, 2);
    const release: () => void = store.hold();
    const all: Promise<unknown> = Promise.all(ids.map((id: string) => p.fetch(id)));
    await new Promise((r: (v: unknown) => void): void => { setTimeout(r, 10); });
    expect(store.gets).toHaveLength(2);
    release();
    await all;
    expect(store.gets).toHaveLength(5);
  });

  it('keeps a lasting failure and does not ask again', async () => {
    const store: MemoryPictures = memoryPictures();
    const p: DocumentPictures = pictures(store);
    const id: string = await sha256ContentId(PNG_4X3);
    expect(await p.fetch(id)).toEqual({ ok: false, failure: { kind: 'notFound' } });
    expect(await p.fetch(id)).toEqual({ ok: false, failure: { kind: 'notFound' } });
    expect(store.gets).toHaveLength(1);
  });

  it('asks again after a passing failure only once the retry interval is over', async () => {
    const store: MemoryPictures = memoryPictures();
    const id: string = await kept(store, PNG_4X3);
    const clock: { t: number } = { t: 0 };
    const p: DocumentPictures = pictures(store, clock);
    store.fail({ kind: 'offline' });
    expect(await p.fetch(id)).toEqual({ ok: false, failure: { kind: 'offline' } });
    store.fail(null);
    clock.t = 999;
    expect(p.fetch(id)).toBeNull();
    clock.t = 1000;
    expect(await p.fetch(id)).toEqual({ ok: true, value: PNG_4X3 });
    expect(store.gets).toHaveLength(2);
  });

  it('answers a store that throws as unavailable rather than failing the paint', async () => {
    const id: string = await sha256ContentId(PNG_4X3);
    const throwing: DocumentPictures = new DocumentPictures({
      port: { put: () => Promise.reject(new Error('x')), get: () => Promise.reject(new Error('socket closed')), maxBytes: () => Promise.reject(new Error('socket closed')) },
      doc: DOC, contentIdOf: sha256ContentId, now: (): number => 0, limits: { fetchConcurrency: 1, retryAfterMs: 1 },
    });
    expect(await throwing.fetch(id)).toEqual({ ok: false, failure: { kind: 'unavailable', detail: 'The picture store could not be read.' } });
    expect(await throwing.maxBytes()).toEqual({ ok: false, failure: { kind: 'unavailable', detail: 'The picture store could not be reached.' } });
  });
});
