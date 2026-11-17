/**
 * The runtime's apps requests: an artifact is assembled from its chunks and refused when the
 * server's chunk count changes or the bytes pass the cap; the runtime answers are read strictly
 * (a field missing or extra is malformed); and the session transport takes one request at a time.
 */
import { describe, expect, it } from 'vitest';
import type { AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import { readAppsAnswer, type AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import { serialAppsTransport, type AppsTransport } from '../apps-operations';
import { callHost, fetchArtifact, getRelease } from '../apps-runtime-operations';
import { listingOf } from '@/test/app-manifests';

/** Answers each request with `raw(request)`, through the production reader. */
const transportOf = (raw: (r: AppsRequest) => unknown): AppsTransport => ({
  request: async (request: AppsRequest, isOurs: (a: AppsAnswer) => boolean): Promise<AppsAnswer> => {
    const a: AppsAnswer = readAppsAnswer(raw(request));
    if (!isOurs(a)) throw new Error('not ours');
    return a;
  },
});
const chunk = (index: number, total: number, bytes: number[]): unknown => ({ ArtifactChunk: { sha256: 'aa', index, total_chunks: total, bytes } });
const indexOf = (r: AppsRequest): number => (r as { FetchArtifact: { index: number } }).FetchArtifact.index;

describe('fetching an artifact', () => {
  it('assembles its chunks in order', async () => {
    const t: AppsTransport = transportOf((r) => chunk(indexOf(r), 3, [indexOf(r), indexOf(r)]));
    expect(await fetchArtifact(t, 'aa', 100)).toEqual({ ok: true, value: Uint8Array.from([0, 0, 1, 1, 2, 2]) });
  });

  it('a chunk count that changes, or bytes past the cap, is malformed (control: at the cap it is whole)', async () => {
    const changing: AppsTransport = transportOf((r) => chunk(indexOf(r), indexOf(r) === 0 ? 2 : 3, [1]));
    expect(await fetchArtifact(changing, 'aa', 100)).toEqual({ ok: false, refusal: 'Malformed' });
    const big: AppsTransport = transportOf((r) => chunk(indexOf(r), 2, [1, 2, 3]));
    expect(await fetchArtifact(big, 'aa', 5)).toEqual({ ok: false, refusal: 'Malformed' });
    expect((await fetchArtifact(big, 'aa', 6)).ok).toBe(true);
  });

  it('a chunk for another index is not ours', async () => {
    const wrong: AppsTransport = transportOf(() => chunk(5, 9, [1]));
    expect(await fetchArtifact(wrong, 'aa', 100)).toEqual({ ok: false, refusal: 'NoAnswer' });
  });
});

describe('the runtime answers, read strictly', () => {
  const listing: AppListing = listingOf();
  it('a release, with or without one waiting on consent (an absent Option arrives undefined)', async () => {
    const t: AppsTransport = transportOf(() => ({ Release: { install_id: 'i', current: listing, waiting_on: undefined } }));
    expect(await getRelease(t, 'i')).toEqual({ ok: true, value: { current: listing, waitingOn: null } });
  });

  it.each([
    ['a release for another install', { Release: { install_id: 'other', current: listing, waiting_on: null } }, 'NoAnswer'],
    ['a release with an extra field', { Release: { install_id: 'i', current: listing, waiting_on: null, extra: 1 } }, 'Malformed'],
  ])('%s is not taken as one', async (_why: string, raw: unknown, refusal: string) => {
    expect(await getRelease(transportOf(() => raw), 'i')).toEqual({ ok: false, refusal });
  });

  it('a call reply is bytes; one of the wrong type is malformed', async () => {
    expect(await callHost(transportOf(() => ({ CallReply: { reply: [1, 2] } })), 'i', new Uint8Array(0))).toEqual({ ok: true, value: Uint8Array.from([1, 2]) });
    expect(readAppsAnswer({ CallReply: { reply: [300] } })).toEqual({ kind: 'malformed' });
    expect(readAppsAnswer({ Refused: 'ArtifactUnreachable' })).toEqual({ kind: 'refused', refusal: 'ArtifactUnreachable' });
    expect(readAppsAnswer({ Refused: { AlreadyInstalled: { install_id: 'x' } } })).toEqual({ kind: 'refused', refusal: { AlreadyInstalled: { install_id: 'x' } } });
  });
});

describe('the serial transport', () => {
  it('starts a request only once the one before it has its answer (control: unwrapped, both start at once)', async () => {
    const started: string[] = [];
    let release: () => void = () => undefined;
    const slow: AppsTransport = {
      request: async (r: AppsRequest): Promise<AppsAnswer> => {
        started.push(JSON.stringify(r));
        if (started.length === 1) await new Promise<void>((done) => { release = done; });
        return { kind: 'install-requested' };
      },
    };
    const serial: AppsTransport = serialAppsTransport(slow);
    const first: Promise<AppsAnswer> = serial.request('ListInstalls', () => true);
    const second: Promise<AppsAnswer> = serial.request('ListCatalogue', () => true);
    await new Promise<void>((done) => setTimeout(done, 10));
    expect(started).toEqual(['"ListInstalls"']);
    release();
    await Promise.all([first, second]);
    expect(started).toEqual(['"ListInstalls"', '"ListCatalogue"']);

    started.length = 0;
    void slow.request('ListInstalls', () => true);
    void slow.request('ListCatalogue', () => true);
    await new Promise<void>((done) => setTimeout(done, 10));
    expect(started.length).toBe(2);
    release();
  });
});
