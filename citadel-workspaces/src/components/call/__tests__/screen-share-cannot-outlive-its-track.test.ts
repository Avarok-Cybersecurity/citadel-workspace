/**
 * Announcing a share must not outlive the share.
 *
 * Starting a screen share is two steps that take very different amounts of
 * time: the browser hands over a track immediately, and then every peer has to
 * be told, over the same P2P link that is carrying the call. Between those two
 * the user can already have stopped the share -- they picked the wrong window
 * and hit the browser's "Stop sharing" bar, or the tab they shared closed
 * itself.
 *
 * The end handler re-read the media state to decide whether to announce a
 * stop, which is the right instinct: the manager is the authority. But at that
 * moment the state still said `screen: false`, because the announcement of the
 * START had not landed yet. So the handler correctly concluded there was
 * nothing to turn off -- and then the start announcement landed on top of it.
 *
 * The button read "Sharing", peers opened a stage, and no frame ever arrived,
 * with no way back except pressing stop and start again.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import type { CallMediaKinds } from '@/types/p2p-commands';
import { useCallMediaToggles } from '../use-call-media-toggles';

const captureScreen: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());
vi.mock('@/lib/call/screen-capture', () => ({ captureScreen }));
// Screen capture is fetched after first paint rather than bundled, so the
// browser has to say it is possible before the fetch happens at all.
vi.mock('@/lib/call/screen-capability', () => ({ canShareScreen: (): boolean => true }));

type Manager = Parameters<typeof useCallMediaToggles>[0] extends MutableRefObject<infer M>
  ? M
  : never;

interface Harness {
  hook: ReturnType<typeof renderHook<ReturnType<typeof useCallMediaToggles>, unknown>>;
  media: () => CallMediaKinds;
  endTheShare: () => void;
  releaseAnnouncement: () => void;
  /** Resolves once the start has been announced but not yet acknowledged. */
  announcementInFlight: () => Promise<void>;
  stopScreen: ReturnType<typeof vi.fn>;
  onScreenEnded: ReturnType<typeof vi.fn>;
}

async function setup(): Promise<Harness> {
  let selfMedia: CallMediaKinds = { audio: true, video: false, screen: false };
  // The announcement is held open so the test can act during it -- which is
  // exactly the window the defect lived in.
  let release: () => void = (): void => {};
  const gate: Promise<void> = new Promise<void>((resolve) => { release = resolve; });

  const setSelfMedia: ReturnType<typeof vi.fn> = vi.fn(async (next: CallMediaKinds): Promise<void> => {
    await gate;
    selfMedia = next;
  });
  const managerRef: MutableRefObject<Manager> = {
    current: { getState: () => ({ selfMedia }), setSelfMedia },
  } as unknown as MutableRefObject<Manager>;

  let onEnded: () => void = (): void => {};
  const stopScreen: ReturnType<typeof vi.fn> = vi.fn();
  const sessionRef: Parameters<typeof useCallMediaToggles>[1] = {
    current: {
      getLocalStream: () => null,
      startScreen: (_stream: MediaStream, ended: () => void): boolean => {
        onEnded = ended;
        return true;
      },
      stopScreen,
      getScreenStream: () => null,
    },
  } as unknown as Parameters<typeof useCallMediaToggles>[1];

  captureScreen.mockResolvedValue({
    ok: true,
    stream: { getTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream,
  });

  const onScreenEnded: ReturnType<typeof vi.fn> = vi.fn();
  const hook: Harness['hook'] = renderHook(() =>
    useCallMediaToggles(managerRef, sessionRef, undefined, undefined, undefined, onScreenEnded),
  );
  // Let the mount-time fetch of the screen-capture module land before pressing
  // anything. That is the production shape: the module is fetched when the
  // provider mounts, and a press minutes later reads it synchronously so the
  // user gesture survives. Pressing while the fetch is still in flight is the
  // cold path, and not what these tests are about.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    hook,
    media: () => selfMedia,
    endTheShare: () => onEnded(),
    releaseAnnouncement: () => release(),
    announcementInFlight: async (): Promise<void> => {
      for (let tick: number = 0; tick < 50 && setSelfMedia.mock.calls.length === 0; tick += 1) {
        await Promise.resolve();
      }
    },
    stopScreen,
    onScreenEnded,
  };
}

describe('a screen share that ends while it is being announced', () => {
  it('does not leave the call claiming to share a stopped screen', async () => {
    const h: Harness = await setup();

    await act(async (): Promise<void> => {
      const toggling: Promise<void> = h.hook.result.current.toggleScreenShare();
      // Wait for the announcement to actually be IN FLIGHT rather than counting
      // microtasks. The first version ticked the queue a fixed number of times,
      // which broke the moment a dynamic import added one -- a test that
      // depends on how many awaits happen to be upstream of it is measuring the
      // wrong thing.
      await h.announcementInFlight();
      // The user presses the browser's own "Stop sharing" here.
      h.endTheShare();
      h.releaseAnnouncement();
      await toggling;
    });

    expect(h.media().screen).toBe(false);
    expect(h.onScreenEnded).toHaveBeenCalledTimes(1);
    expect(h.stopScreen).toHaveBeenCalled();
  });

  it('still announces a share that is still running when the announcement lands', async () => {
    const h: Harness = await setup();

    await act(async (): Promise<void> => {
      const toggling: Promise<void> = h.hook.result.current.toggleScreenShare();
      await h.announcementInFlight();
      h.releaseAnnouncement();
      await toggling;
    });

    expect(h.media().screen).toBe(true);
    expect(h.onScreenEnded).not.toHaveBeenCalled();
  });
});

/**
 * The same shape, one device over: a webcam unplugged, or a microphone yanked
 * out of the jack, while the announcement that it had just been turned ON was
 * still travelling to the peers. The toggle already refuses to turn on a device
 * whose track is dead -- but it checks before the announcement, and the check
 * cannot see a device that dies during it.
 */
function deviceSetup(kind: 'audio' | 'video'): {
  hook: ReturnType<typeof renderHook<ReturnType<typeof useCallMediaToggles>, unknown>>;
  media: () => CallMediaKinds;
  unplug: () => void;
  releaseAnnouncement: () => void;
  announcementInFlight: () => Promise<void>;
} {
  let selfMedia: CallMediaKinds = { audio: false, video: false, screen: false };
  let release: () => void = (): void => {};
  const gate: Promise<void> = new Promise<void>((resolve) => { release = resolve; });
  const setSelfMedia: ReturnType<typeof vi.fn> = vi.fn(async (next: CallMediaKinds): Promise<void> => {
    await gate;
    selfMedia = next;
  });
  const managerRef: MutableRefObject<Manager> = {
    current: { getState: () => ({ selfMedia }), setSelfMedia },
  } as unknown as MutableRefObject<Manager>;

  const track: { enabled: boolean; readyState: 'live' | 'ended' } = { enabled: false, readyState: 'live' };
  const sessionRef: Parameters<typeof useCallMediaToggles>[1] = {
    current: {
      getLocalStream: (): unknown => ({
        getAudioTracks: (): unknown[] => (kind === 'audio' ? [track] : []),
        getVideoTracks: (): unknown[] => (kind === 'video' ? [track] : []),
      }),
    },
  } as unknown as Parameters<typeof useCallMediaToggles>[1];

  const hook: ReturnType<typeof renderHook<ReturnType<typeof useCallMediaToggles>, unknown>> =
    renderHook(() => useCallMediaToggles(managerRef, sessionRef));
  return {
    hook,
    media: (): CallMediaKinds => selfMedia,
    unplug: (): void => { track.readyState = 'ended'; },
    releaseAnnouncement: (): void => release(),
    announcementInFlight: async (): Promise<void> => {
      for (let tick: number = 0; tick < 50 && setSelfMedia.mock.calls.length === 0; tick += 1) {
        await Promise.resolve();
      }
    },
  };
}

describe('a device that dies while it is being announced', () => {
  it.each([
    ['audio', 'toggleMic'],
    ['video', 'toggleCamera'],
  ] as const)('does not leave the call claiming a %s device that is gone', async (kind, press) => {
    const h: ReturnType<typeof deviceSetup> = deviceSetup(kind);

    await act(async (): Promise<void> => {
      const toggling: Promise<void> = h.hook.result.current[press]();
      await h.announcementInFlight();
      h.unplug();
      h.releaseAnnouncement();
      await toggling;
    });

    expect(h.media()[kind]).toBe(false);
  });

  it.each([
    ['audio', 'toggleMic'],
    ['video', 'toggleCamera'],
  ] as const)('still announces a %s device that survives the announcement', async (kind, press) => {
    const h: ReturnType<typeof deviceSetup> = deviceSetup(kind);

    await act(async (): Promise<void> => {
      const toggling: Promise<void> = h.hook.result.current[press]();
      await h.announcementInFlight();
      h.releaseAnnouncement();
      await toggling;
    });

    expect(h.media()[kind]).toBe(true);
  });
});
