/**
 * The chime must not construct an AudioContext per play.
 *
 * Browsers cap live AudioContexts (Chromium at about six). A fresh context per
 * chime — never closed — hit the cap after a handful of notifications; from
 * then on the constructor threw into the chime's bare catch and sound died
 * silently for the rest of the session. jsdom has no real cap, so these tests
 * assert the construction count directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const started: ReturnType<typeof vi.fn> = vi.fn();
const instances: MockAudioContext[] = [];

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime: number = 0;
  destination: AudioDestinationNode = {} as AudioDestinationNode;
  constructor() { instances.push(this); }
  createOscillator(): OscillatorNode {
    return {
      connect: vi.fn(),
      frequency: { setValueAtTime: vi.fn() },
      start: started,
      stop: vi.fn(),
    } as unknown as OscillatorNode;
  }
  createGain(): GainNode {
    return {
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    } as unknown as GainNode;
  }
}

/**
 * The shared context is module state, so each test gets a fresh module rather
 * than a production reset hook that would exist only for tests.
 */
async function freshChime(): Promise<() => void> {
  vi.resetModules();
  return (await import('../chime')).playNotificationChime;
}

describe('the notification chime', () => {
  beforeEach(() => {
    instances.length = 0;
    started.mockReset();
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('constructs one AudioContext across many chimes', async () => {
    const play: () => void = await freshChime();

    for (let i: number = 0; i < 8; i++) { play(); }

    // Eight per-chime contexts is past Chromium's cap of ~6 live contexts.
    expect(instances).toHaveLength(1);
  });

  it('still starts a tone on every chime (opposite direction)', async () => {
    // Without this, "one context that never plays" would pass the test above.
    const play: () => void = await freshChime();

    for (let i: number = 0; i < 8; i++) { play(); }

    expect(started).toHaveBeenCalledTimes(8);
  });

  it('replaces a context the browser has closed instead of chiming into it', async () => {
    const play: () => void = await freshChime();
    play();
    instances[0].state = 'closed';

    play();

    expect(instances).toHaveLength(2);
    expect(started).toHaveBeenCalledTimes(2);
  });
});
