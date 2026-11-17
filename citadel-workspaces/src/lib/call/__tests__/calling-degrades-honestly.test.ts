/**
 * Three defects that all present as a call which looks healthy and carries
 * nothing. Each fix propagates a pattern the sibling code already had.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MediaCapabilityReport } from '@/lib/call/codec-support';

const g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const KEYS: string[] = [
  'AudioEncoder', 'AudioDecoder', 'VideoEncoder', 'VideoDecoder',
  'MediaStreamTrackProcessor', 'MediaStreamTrackGenerator',
];

function stubWebCodecs(): void {
  for (const k of KEYS) saved[k] = g[k];
  // Enough of WebCodecs for the probe to get past its first gate.
  g.AudioEncoder = Object.assign(function () {}, {
    isConfigSupported: () => Promise.resolve({ supported: true }),
  });
  g.AudioDecoder = function (): void {};
  g.VideoEncoder = Object.assign(function () {}, {
    isConfigSupported: () => Promise.resolve({ supported: false }),
  });
  g.VideoDecoder = function (): void {};
  g.MediaStreamTrackProcessor = function (): void {};
  g.MediaStreamTrackGenerator = function (): void {};
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({}), enumerateDevices: () => Promise.resolve([]) },
  });
}

describe('probeMediaCapabilities', () => {
  beforeEach(() => { vi.resetModules(); stubWebCodecs(); });
  afterEach(() => { for (const k of KEYS) g[k] = saved[k]; });

  it('refuses to report supported without MediaStreamTrackProcessor', async () => {
    delete g.MediaStreamTrackProcessor;
    const { probeMediaCapabilities } = await import('../codec-support');

    const result: MediaCapabilityReport = await probeMediaCapabilities();

    // Previously supported:true — the call rang, connected, ticked its timer
    // and carried no audio in either direction.
    expect(result.supported).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('refuses to report supported without MediaStreamTrackGenerator', async () => {
    delete g.MediaStreamTrackGenerator;
    const { probeMediaCapabilities } = await import('../codec-support');

    expect((await probeMediaCapabilities()).supported).toBe(false);
  });

  it('still reports supported when both are present', async () => {
    const { probeMediaCapabilities } = await import('../codec-support');

    expect((await probeMediaCapabilities()).supported).toBe(true);
  });
});

describe('hasTrackTransforms', () => {
  beforeEach(() => { vi.resetModules(); stubWebCodecs(); });
  afterEach(() => { for (const k of KEYS) g[k] = saved[k]; });

  it('requires both constructors, not either', async () => {
    const { hasTrackTransforms } = await import('../track-transforms');
    expect(hasTrackTransforms()).toBe(true);

    delete g.MediaStreamTrackGenerator;
    vi.resetModules();
    const again: typeof import('../track-transforms') = await import('../track-transforms');
    expect(again.hasTrackTransforms()).toBe(false);
  });
});
