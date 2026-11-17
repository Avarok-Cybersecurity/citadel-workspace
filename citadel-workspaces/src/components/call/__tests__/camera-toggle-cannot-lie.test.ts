/**
 * The camera toggle must not report a camera the call does not have.
 *
 * `captureLocalMedia` falls back to audio-only when video fails — a blocked
 * camera, no camera at all — and that fallback is right: a call worth having
 * beats no call. But the fallback returned `ok: true` with no other signal, so
 * nothing told the user. Then pressing "Turn camera on" enabled zero video
 * tracks, flipped the button to on, and announced `video: true` to every peer,
 * whose tiles showed a camera badge for a stream that would never arrive.
 *
 * Two independent audits found this the same week, from opposite directions —
 * one looking for silent failures, one for call-state divergence.
 */
import { describe, it, expect, vi   } from 'vitest';
import { renderHook, act , type RenderHookResult } from '@testing-library/react';
import { useCallMediaToggles } from '../use-call-media-toggles';
import type { MutableRefObject } from 'react';
import type { CallMediaToggles } from '@/components/call/use-call-media-toggles';

type Manager = Parameters<typeof useCallMediaToggles>[0] extends MutableRefObject<infer M>
  ? M
  : never;

interface Harness {
  hook: RenderHookResult<CallMediaToggles, unknown>;
  setSelfMedia: ReturnType<typeof vi.fn>;
  onCameraUnavailable: ReturnType<typeof vi.fn>;
  tracks: { enabled: boolean; readyState: 'live' }[];
}

function setup(videoTracks: number, selfVideo: boolean = false): Harness {
  const setSelfMedia: ReturnType<typeof vi.fn> = vi.fn((): Promise<void> => Promise.resolve());
  // `readyState` matters now: the toggle filters to LIVE tracks, because an
  // ended one stays in the stream's list and flipping `enabled` on it is a
  // no-op that still announced a state change to every peer.
  const tracks: { enabled: boolean; readyState: "live"; }[] = Array.from({ length: videoTracks }, (): { enabled: boolean; readyState: "live"; } => ({
    enabled: false,
    readyState: 'live' as const,
  }));
  const managerRef: MutableRefObject<Manager> = {
    current: {
      getState: () => ({ selfMedia: { audio: true, video: selfVideo, screen: false } }),
      setSelfMedia,
    },
  } as unknown as MutableRefObject<Manager>;
  const sessionRef: Parameters<typeof useCallMediaToggles>[1] = {
    current: { getLocalStream: (): { getVideoTracks: () => { enabled: boolean; readyState: "live"; }[]; getAudioTracks: () => never[]; } => ({ getVideoTracks: (): { enabled: boolean; readyState: "live"; }[] => tracks, getAudioTracks: (): never[] => [] }) },
  } as unknown as Parameters<typeof useCallMediaToggles>[1];
  const onCameraUnavailable: ReturnType<typeof vi.fn> = vi.fn();
  const hook: RenderHookResult<CallMediaToggles, unknown> = renderHook((): CallMediaToggles =>
    useCallMediaToggles(managerRef, sessionRef, onCameraUnavailable),
  );
  return { hook, setSelfMedia, onCameraUnavailable, tracks };
}

describe('toggleCamera', () => {
  it('does not announce video when there is no video track to send', async () => {
    const { hook, setSelfMedia, onCameraUnavailable } = setup(0);

    await act(() => hook.result.current.toggleCamera());

    expect(setSelfMedia).not.toHaveBeenCalled();
    expect(onCameraUnavailable).toHaveBeenCalledTimes(1);
  });

  it('turns the camera on when a track actually exists', async () => {
    const { hook, setSelfMedia, onCameraUnavailable, tracks } = setup(1);

    await act(() => hook.result.current.toggleCamera());

    expect(setSelfMedia).toHaveBeenCalledWith({ audio: true, video: true, screen: false });
    expect(tracks[0].enabled).toBe(true);
    expect(onCameraUnavailable).not.toHaveBeenCalled();
  });

  it('always allows turning the camera OFF, whatever the track count', async () => {
    // Turning off is never a lie, and refusing it would strand a user whose
    // track vanished with their peers still told video is coming.
    const { hook, setSelfMedia, onCameraUnavailable } = setup(0, true);

    await act(() => hook.result.current.toggleCamera());

    expect(setSelfMedia).toHaveBeenCalledWith({ audio: true, video: false, screen: false });
    expect(onCameraUnavailable).not.toHaveBeenCalled();
  });

  it('refuses to turn the camera on when its track has ended', () => {
    // A camera unplugged mid-call leaves a dead track in the stream, so the
    // old count-based guard saw one video track and let the toggle through.
    const { hook, setSelfMedia, onCameraUnavailable, tracks } = setup(1);
    (tracks[0] as { readyState: string }).readyState = 'ended';

    void hook.result.current.toggleCamera();

    expect(setSelfMedia).not.toHaveBeenCalled();
    expect(onCameraUnavailable).toHaveBeenCalled();
  });
});
