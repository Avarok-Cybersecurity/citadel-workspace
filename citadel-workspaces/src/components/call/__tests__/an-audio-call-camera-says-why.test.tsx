/**
 * In an audio call the camera button says why it cannot be used.
 *
 * Seen on the live bench: in an audio call, `call-toggle-camera` looked live
 * and pressing it did nothing visible. An audio call captures no video track,
 * and there is no mid-call upgrade -- the capture, the encoder and the codec
 * both peers negotiated are all fixed when the call is placed -- so the toggle
 * could only refuse. It refused in a toast that raced everything else on
 * screen, behind a button that promised otherwise.
 *
 * The control now asks the same question the toggle does -- is there a live
 * video track? -- and when there is not, it is disabled with the reason on it,
 * the treatment every other in-call control already has.
 */
import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallStage } from '../CallStage';
import { cameraControlUsable, NO_CAMERA_IN_CALL } from '../call-control-availability';
import type { CallState } from '@/lib/call/call-state';

/** The two parts of a MediaStream this rule reads; jsdom has no MediaStream. */
function streamWith(video: Array<'live' | 'ended'>): MediaStream {
  const tracks: Array<Partial<MediaStreamTrack>> = video.map((readyState) => ({ kind: 'video', readyState }));
  return { getVideoTracks: (): MediaStreamTrack[] => tracks as MediaStreamTrack[] } as unknown as MediaStream;
}

function activeAudioCall(): CallState {
  return {
    callId: 'c1', status: 'active', selfSpeaking: false, home: { kind: 'direct' }, outgoing: true, caller: null,
    selfMedia: { audio: true, video: false, screen: false },
    participants: new Map([[2n, { cid: 2n, username: 'bob', status: 'active', media: { audio: true, video: false, screen: false }, speaking: false }]]),
    reason: null,
  };
}

function renderStage(localStream: MediaStream | null, onToggleCamera: () => void): void {
  const props: React.ComponentProps<typeof CallStage> = {
    call: activeAudioCall(), selfUsername: 'Me', localStream, remoteStreams: new Map<bigint, MediaStream>(),
    onToggleMic: vi.fn(), onToggleCamera, onLeave: vi.fn(),
  };
  render(<CallStage {...props} />);
}

describe('the camera control in a call', () => {
  it('is disabled, with the reason, when the call captured no video', async () => {
    const onToggleCamera: ReturnType<typeof vi.fn> = vi.fn();
    renderStage(streamWith([]), onToggleCamera);

    const camera: HTMLElement = screen.getByTestId('call-toggle-camera');
    expect(camera).toHaveAttribute('aria-disabled', 'true');
    expect(camera).toHaveAccessibleDescription(NO_CAMERA_IN_CALL);
    await userEvent.click(camera);
    expect(onToggleCamera).not.toHaveBeenCalled();
  });

  it('stays usable in a video call, camera off or on', async () => {
    // Positive control: a turned-off camera is a live, disabled-for-privacy
    // track, and turning it back on is exactly what the button is for.
    const onToggleCamera: ReturnType<typeof vi.fn> = vi.fn();
    renderStage(streamWith(['live']), onToggleCamera);

    const camera: HTMLElement = screen.getByTestId('call-toggle-camera');
    expect(camera).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(camera);
    expect(onToggleCamera).toHaveBeenCalledTimes(1);
  });
});

describe('cameraControlUsable', () => {
  it('counts only live video tracks', () => {
    expect(cameraControlUsable('active', streamWith(['ended'])).usable).toBe(false);
    expect(cameraControlUsable('active', streamWith(['ended', 'live'])).usable).toBe(true);
  });

  it('defers to the call itself first', () => {
    expect(cameraControlUsable('failed', streamWith(['live']))).toEqual({ usable: false, reason: 'The call never connected' });
  });

  it('does not judge a call whose capture has not been handed over yet', () => {
    expect(cameraControlUsable('connecting', null).usable).toBe(true);
  });
});
