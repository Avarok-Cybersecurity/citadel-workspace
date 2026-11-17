/**
 * The mic and camera toggles.
 *
 * Split from CallProvider so that file holds call lifecycle and this holds
 * device state — they change for different reasons, and the provider was at its
 * 250-line budget.
 */

import { useCallback, useEffect, useRef , type MutableRefObject } from 'react';
import type { CallMediaKinds } from '@/types/p2p-commands';
import { canShareScreen } from '@/lib/call/screen-capability';
import type { captureScreen as CaptureScreen } from '@/lib/call/screen-capture';
import type { CaptureFailure } from '@/lib/call/media-capture';

/** The screen-capture module, once it has been fetched. */
type ScreenCaptureModule = { captureScreen: typeof CaptureScreen };

interface ManagerLike {
  getState: () => { selfMedia?: CallMediaKinds } | null | undefined;
  setSelfMedia: (next: CallMediaKinds) => Promise<void>;
}

interface SessionLike {
  getLocalStream: () => MediaStream | null | undefined;
  startScreen?: (stream: MediaStream, onEnded: () => void) => boolean;
  stopScreen?: () => void;
  getScreenStream?: () => MediaStream | null;
}

export interface CallMediaToggles {
  setMedia: (next: CallMediaKinds) => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
}

export function useCallMediaToggles(
  managerRef: MutableRefObject<ManagerLike | null>,
  sessionRef: MutableRefObject<SessionLike | null>,
  /** Called when the camera cannot be turned on because no track was captured. */
  onCameraUnavailable?: () => void,
  /** Called when the microphone cannot be turned on because its track is gone. */
  onMicUnavailable?: () => void,
  /** Called when a screen could not be captured, with something to say about it. */
  onScreenUnavailable?: (failure: CaptureFailure) => void,
  /** Called when the browser's own "Stop sharing" ended the share. */
  onScreenEnded?: () => void,
): CallMediaToggles {
  /**
   * `captureScreen` is fetched after first paint, not bundled with the app.
   *
   * CallProvider is mounted app-wide, so a plain import put screen capture --
   * and, through it, `media-capture` and the codec tables -- on the landing
   * page's critical path. Measured at 1.6 KB downloaded before anybody can see
   * the sign-in button, for a feature that only exists inside a call.
   *
   * Held in a ref and read SYNCHRONOUSLY at press time, because
   * `getDisplayMedia` must be called from a user gesture and an await before it
   * spends the gesture. The `await import` below it is the cold path only: a
   * press within the first moments of the page, where losing the gesture costs
   * a second press and not a broken feature.
   */
  const screenCapture: MutableRefObject<ScreenCaptureModule | null> =
    useRef<ScreenCaptureModule | null>(null);
  useEffect(() => {
    if (!canShareScreen()) return;
    let abandoned: boolean = false;
    void import('@/lib/call/screen-capture').then((module: ScreenCaptureModule): void => {
      if (!abandoned) screenCapture.current = module;
    });
    return (): void => { abandoned = true; };
  }, []);

  const setMedia: (next: CallMediaKinds) => Promise<void> = useCallback(
    async (next: CallMediaKinds): Promise<void> => {
      await managerRef.current?.setSelfMedia(next);
    },
    [managerRef]
  );

  /**
   * Take back an announcement whose subject stopped existing while it was in
   * flight.
   *
   * Every toggle checks that the thing it is about to announce actually works,
   * and then announces it -- which is a round trip to every peer over the same
   * link that carries the call. A check made before that round trip cannot see
   * a webcam unplugged, a microphone pulled, or a screen share stopped from the
   * browser's own bar, DURING it. What was left behind was a button reading
   * "on" over a device that was gone, and peers holding a tile for a stream
   * that would never arrive.
   *
   * The state is re-read rather than carried in, because the manager is the
   * authority and the announcement that just landed is what it now holds.
   */
  const reconcile: (kind: keyof CallMediaKinds, survived: () => boolean) => Promise<void> = useCallback(
    async (kind: keyof CallMediaKinds, survived: () => boolean): Promise<void> => {
      if (survived()) return;
      const now: CallMediaKinds | undefined = managerRef.current?.getState()?.selfMedia;
      if (now?.[kind]) await setMedia({ ...now, [kind]: false });
    },
    [managerRef, setMedia],
  );

  /**
   * `track.enabled = false` blanks the frames but keeps the device open, which
   * is the standard idiom for a mute toggle and is what peers expect from a
   * mid-call mute. Note for the camera: it means the indicator light stays on
   * after the user turns their camera off. Recorded in docs/ROBUSTNESS.md as a
   * decision to revisit — in a product that sells privacy, a light that stays
   * on reads as "it is still watching me".
   */
  const toggleMic: () => Promise<void> = useCallback(async (): Promise<void> => {
    const current: CallMediaKinds | undefined = managerRef.current?.getState()?.selfMedia;
    if (!current) return;
    const stream: MediaStream | null | undefined = sessionRef.current?.getLocalStream();
    // Only LIVE tracks. An ended track stays in the stream's track list, so
    // flipping `enabled` on one is a no-op that still announced a state
    // change: after the microphone was unplugged, pressing unmute told every
    // peer the mic was back and left the button reading unmuted, on a device
    // that no longer existed.
    const audioTracks: MediaStreamTrack[] = (stream?.getAudioTracks() ?? []).filter(
      (track) => track.readyState === 'live',
    );

    if (!current.audio && audioTracks.length === 0) {
      onMicUnavailable?.();
      return;
    }

    const turningOn: boolean = !current.audio;
    for (const track of audioTracks) track.enabled = turningOn;
    await setMedia({ ...current, audio: turningOn });
    if (turningOn) {
      await reconcile('audio', () => audioTracks.some((t) => t.readyState === 'live'));
    }
  }, [setMedia, reconcile, managerRef, sessionRef, onMicUnavailable]);

  const toggleCamera: () => Promise<void> = useCallback(async (): Promise<void> => {
    const current: CallMediaKinds | undefined = managerRef.current?.getState()?.selfMedia;
    if (!current) return;
    const stream: MediaStream | null | undefined = sessionRef.current?.getLocalStream();
    // Live only, for the same reason as the microphone above: the count-based
    // guard below is defeated by a dead track still sitting in the list.
    const videoTracks: MediaStreamTrack[] = (stream?.getVideoTracks() ?? []).filter(
      (track) => track.readyState === 'live',
    );

    // Turning the camera ON with no video track was a no-op that reported
    // success: the loop below iterated nothing, then `setMedia` flipped the
    // button to "on" and announced `video: true` to every peer. Their tiles
    // showed a camera badge and no frame ever arrived. This happens whenever
    // capture fell back to audio-only — a blocked camera, or no camera at all.
    if (!current.video && videoTracks.length === 0) {
      onCameraUnavailable?.();
      return;
    }

    const turningOn: boolean = !current.video;
    for (const track of videoTracks) track.enabled = turningOn;
    await setMedia({ ...current, video: turningOn });
    if (turningOn) {
      await reconcile('video', () => videoTracks.some((t) => t.readyState === 'live'));
    }
  }, [setMedia, reconcile, managerRef, sessionRef, onCameraUnavailable]);

  /**
   * Start or stop sharing this screen.
   *
   * Three things make this different from the mic and camera toggles:
   *
   *  - it must run inside a user gesture, or the browser will not open its
   *    picker -- so no `await` may precede `getDisplayMedia`;
   *  - dismissing the picker is a person changing their mind, not an error, and
   *    is reported as such rather than raised;
   *  - the share can end without this app being asked, from the browser's own
   *    "Stop sharing" bar. `onEnded` is how the button gets put back; without
   *    it the UI would read "sharing" over a track that had stopped.
   */
  const toggleScreenShare: () => Promise<void> = useCallback(async (): Promise<void> => {
    const current: CallMediaKinds | undefined = managerRef.current?.getState()?.selfMedia;
    if (!current) return;
    const session: SessionLike | null = sessionRef.current;
    if (!session?.startScreen || !session.stopScreen) return;

    if (current.screen) {
      session.stopScreen();
      await setMedia({ ...current, screen: false });
      return;
    }

    const capture: ScreenCaptureModule =
      screenCapture.current ?? (await import('@/lib/call/screen-capture'));
    const result: Awaited<ReturnType<typeof CaptureScreen>> = await capture.captureScreen();
    if (!result.ok) {
      // A dismissed picker says nothing. Anything else is worth explaining.
      if (!result.cancelled) onScreenUnavailable?.(result.failure);
      return;
    }

    let ended: boolean = false;
    const started: boolean = session.startScreen(result.stream, (): void => {
      ended = true;
      // Ended from the browser's bar. The manager is the authority on media
      // state, so re-read it rather than closing over the value from before.
      const now: CallMediaKinds | undefined = managerRef.current?.getState()?.selfMedia;
      session.stopScreen?.();
      if (now?.screen) void setMedia({ ...now, screen: false });
      onScreenEnded?.();
    });

    if (!started) {
      for (const track of result.stream.getTracks()) track.stop();
      return;
    }
    await setMedia({ ...current, screen: true });

    // The end handler above ran while the state still said `screen: false`,
    // found nothing to turn off, and was then overwritten by the announcement
    // it was racing.
    await reconcile('screen', () => !ended);
  }, [setMedia, reconcile, managerRef, sessionRef, onScreenUnavailable, onScreenEnded]);

  return { setMedia, toggleMic, toggleCamera, toggleScreenShare };
}
