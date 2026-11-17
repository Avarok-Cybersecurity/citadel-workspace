/**
 * A page no service worker controls still learns that a new build is deployed.
 *
 * Before this, the only deploy signal was the worker's `waiting` event, so a first
 * visit, a browser that refused the worker, or a build that did not register one
 * ran the superseded bundle until something else forced a reload. Nothing is
 * mocked: the watch takes its I/O as arguments, and these hand it a fake server.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { OutputAsset, OutputChunk } from 'rollup';
import { isNewDeploy, readDeployedEntry, versionManifest } from '../deployed-version';
import { respondToDeploy, startVersionWatch, type VersionWatchIO } from '../version-watch';
import { manifestForBuild } from '../version-manifest';
import { clearDeployNoticeForTests, getDeployNotice, offerDeployNotice } from '../deploy-notice';

const ORIGIN: string = 'https://bench.work.avarok.net';
const RUNNING: string = `${ORIGIN}/assets/index-aaaa1111.js`;

interface Harness { io: VersionWatchIO; wake: () => void; tick: () => void; deploys: () => number }

function harness(served: () => unknown, online: boolean = true): Harness {
  let tick: () => void = () => undefined;
  let wake: () => void = () => undefined;
  let deploys: number = 0;
  const io: VersionWatchIO = {
    runningEntry: RUNNING,
    // Any seq: these manifests carry no kill switch (kill-switch tests cover minSeq).
    runningSeq: 1000,
    origin: ORIGIN,
    intervalMs: 600_000,
    fetchManifest: async (): Promise<unknown> => served(),
    isOnline: (): boolean => online,
    onWake: (check: () => void): (() => void) => { wake = check; return (): void => { wake = (): void => undefined; }; },
    setInterval: (fn: () => void): unknown => { tick = fn; return 1; },
    clearInterval: (): void => { tick = (): void => undefined; },
    onNewDeploy: (): void => { deploys += 1; },
    onKillSwitch: (): void => { throw new Error('no manifest here names a minSeq'); },
  };
  return { io, wake: (): void => wake(), tick: (): void => tick(), deploys: (): number => deploys };
}

const settle: () => Promise<void> = async (): Promise<void> => { for (let i: number = 0; i < 5; i += 1) await Promise.resolve(); };

describe('telling a new build from the running one', () => {
  it('compares the entry chunk by path, whatever origin each is written against', () => {
    expect(isNewDeploy(RUNNING, '/assets/index-aaaa1111.js', ORIGIN)).toBe(false);
    expect(isNewDeploy(RUNNING, '/assets/index-bbbb2222.js', ORIGIN)).toBe(true);
  });

  it('treats anything that is not a manifest as no news', () => {
    expect(readDeployedEntry(JSON.parse(versionManifest({ entry: '/assets/index-b.js', seq: 1 })))).toBe('/assets/index-b.js');
    for (const body of [null, 'index.html', {}, { entry: '' }, { entry: 7 }]) {
      expect(readDeployedEntry(body)).toBeNull();
    }
    expect(isNewDeploy(RUNNING, null, ORIGIN)).toBe(false);
  });
});

describe('the build names its entry', () => {
  const chunk: (fileName: string, facadeModuleId: string, isEntry: boolean) => OutputChunk = (fileName: string, facadeModuleId: string, isEntry: boolean): OutputChunk =>
    ({ type: 'chunk', fileName, facadeModuleId, isEntry }) as OutputChunk;

  // The facade is index.html, as Rollup reports it for a real `vite build` (measured):
  // an earlier fixture used src/main.tsx, which no build produces, and the real build failed.
  it('writes the entry index.html loads, under the base', () => {
    const bundle: Record<string, OutputChunk | OutputAsset> = {
      a: chunk('assets/index-bbbb2222.js', '/app/index.html', true),
      b: chunk('assets/Landing-cccc.js', '/app/src/pages/Landing.tsx', false),
    };
    expect(JSON.parse(manifestForBuild(bundle, '/', { seq: 1700000000, minSeq: null }))).toEqual({ entry: '/assets/index-bbbb2222.js', seq: 1700000000 });
  });

  it('refuses a build it cannot identify', () => {
    expect(() => manifestForBuild({}, '/', { seq: 1, minSeq: null })).toThrow(/found 0/);
  });
});

describe('watching for a deploy', () => {
  it('reports nothing while the server serves the running build', async () => {
    const h: Harness = harness(() => ({ entry: '/assets/index-aaaa1111.js' }));
    startVersionWatch(h.io);
    h.tick(); h.wake();
    await settle();
    expect(h.deploys()).toBe(0);
  });

  it('reports a new build once, however often it is seen again', async () => {
    const h: Harness = harness(() => ({ entry: '/assets/index-bbbb2222.js' }));
    startVersionWatch(h.io);
    await settle();
    h.tick(); h.wake();
    await settle();
    expect(h.deploys()).toBe(1);
  });

  it('checks when the tab is shown again, not only on the timer', async () => {
    let entry: string = '/assets/index-aaaa1111.js';
    const h: Harness = harness(() => ({ entry }));
    startVersionWatch(h.io);
    await settle();
    entry = '/assets/index-bbbb2222.js';
    h.wake();
    await settle();
    expect(h.deploys()).toBe(1);
  });

  it('does not ask while offline, and stops when told to', async () => {
    const served: ReturnType<typeof vi.fn> = vi.fn(() => ({ entry: '/assets/index-bbbb2222.js' }));
    startVersionWatch(harness(served, false).io);
    await settle();
    expect(served).not.toHaveBeenCalled();

    const h: Harness = harness(served);
    const stop: () => void = startVersionWatch(h.io);
    stop();
    served.mockClear();
    h.tick(); h.wake();
    expect(served).not.toHaveBeenCalled();
  });
});

describe('what a detected deploy does', () => {
  beforeEach(() => clearDeployNoticeForTests());

  it('offers a plain reload when no worker controls the page', () => {
    const reload: ReturnType<typeof vi.fn> = vi.fn();
    respondToDeploy({ workerControlsPage: () => false, checkWorker: async () => undefined, reload });
    expect(getDeployNotice()?.reason).toBe('deployed');
    getDeployNotice()?.accept();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('asks the worker instead when one does, since a reload would serve the old build', () => {
    const checkWorker: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
    respondToDeploy({ workerControlsPage: () => true, checkWorker, reload: vi.fn() });
    expect(checkWorker).toHaveBeenCalledOnce();
    expect(getDeployNotice()).toBeNull();
  });

  it('never demotes a waiting worker offer to a plain reload', () => {
    const activate: () => void = vi.fn();
    offerDeployNotice({ reason: 'waiting', accept: activate });
    offerDeployNotice({ reason: 'deployed', accept: vi.fn() });
    expect(getDeployNotice()?.accept).toBe(activate);
  });
});
