/**
 * Every branch here is a state the user actually hits — permission blocked, no
 * camera, another app holding the device — and each one looks like "the call is
 * broken" unless it is named and acted on correctly.
 *
 * navigator.mediaDevices is stubbed because it is a browser capability with no
 * jsdom implementation; everything under test is our own logic around it.
 */
import { describe, it, expect, vi, afterEach   } from 'vitest';
import type { CaptureFailure, CaptureResult } from '@/lib/call/media-capture';
import {
  classifyCaptureError,
  captureLocalMedia,
  canStartCall,
  stopStream,
} from '../media-capture';

function domError(name: string): DOMException {
  return new DOMException('denied', name);
}

function stubMediaDevices(getUserMedia: unknown): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia, enumerateDevices: async () => [] },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('classifyCaptureError', () => {
  it('distinguishes a denied permission from a missing device', () => {
    // These need opposite responses from the user: one is fixable in the
    // address bar, the other means plug something in. Collapsing both to
    // "could not access camera" is the common, unhelpful choice.
    expect(classifyCaptureError(domError('NotAllowedError')).kind).toBe('permission-denied');
    expect(classifyCaptureError(domError('NotFoundError')).kind).toBe('no-device');
  });

  it('marks a denied permission retryable, a missing device not', () => {
    expect(classifyCaptureError(domError('NotAllowedError')).retryable).toBe(true);
    expect(classifyCaptureError(domError('NotFoundError')).retryable).toBe(false);
  });

  it('recognises a device held by another application', () => {
    const failure: CaptureFailure = classifyCaptureError(domError('NotReadableError'));

    expect(failure.kind).toBe('device-in-use');
    expect(failure.retryable).toBe(true);
    expect(failure.message).toMatch(/another application/i);
  });

  it('treats over-constrained as no usable device', () => {
    expect(classifyCaptureError(domError('OverconstrainedError')).kind).toBe('no-device');
  });

  it('falls back to a retryable unknown for anything unrecognised', () => {
    const failure: CaptureFailure = classifyCaptureError(new Error('something else'));

    expect(failure.kind).toBe('unknown');
    expect(failure.retryable).toBe(true);
  });
});

describe('captureLocalMedia', () => {
  it('reports an insecure context distinctly, since HTTPS is the fix', () => {
    // getUserMedia is simply absent over plain http, which otherwise surfaces as
    // a baffling generic failure.
    const result: Promise<CaptureResult> = captureLocalMedia({ audio: true, video: false });

    return result.then((r) => {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failure.kind).toBe('insecure-context');
        expect(r.failure.message).toMatch(/HTTPS/i);
      }
    });
  });

  it('returns the stream when capture succeeds', async () => {
    const stream: MediaStream = { getTracks: () => [] } as unknown as MediaStream;
    stubMediaDevices(vi.fn().mockResolvedValue(stream));

    const result: CaptureResult = await captureLocalMedia({ audio: true, video: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stream).toBe(stream);
  });

  it('falls back to audio when only the camera is blocked', async () => {
    // The important behaviour: a blocked camera must not cost the user the call.
    const audioStream: MediaStream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia: ReturnType<typeof vi.fn> = vi
      .fn()
      .mockRejectedValueOnce(domError('NotAllowedError'))
      .mockResolvedValueOnce(audioStream);
    stubMediaDevices(getUserMedia);

    const result: CaptureResult = await captureLocalMedia({ audio: true, video: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stream).toBe(audioStream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0].video).toBe(false);
  });

  it('reports the original failure when audio fails too', async () => {
    const getUserMedia: ReturnType<typeof vi.fn> = vi.fn().mockRejectedValue(domError('NotAllowedError'));
    stubMediaDevices(getUserMedia);

    const result: CaptureResult = await captureLocalMedia({ audio: true, video: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('permission-denied');
  });

  it('does not retry when only audio was asked for', async () => {
    const getUserMedia: ReturnType<typeof vi.fn> = vi.fn().mockRejectedValue(domError('NotFoundError'));
    stubMediaDevices(getUserMedia);

    const result: CaptureResult = await captureLocalMedia({ audio: true, video: false });

    expect(result.ok).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('refuses a call with neither microphone nor camera requested', async () => {
    stubMediaDevices(vi.fn());
    const result: CaptureResult = await captureLocalMedia({ audio: false, video: false });

    expect(result.ok).toBe(false);
  });
});

describe('canStartCall', () => {
  const mic: MediaDeviceInfo = { kind: 'audioinput' } as MediaDeviceInfo;
  const cam: MediaDeviceInfo = { kind: 'videoinput' } as MediaDeviceInfo;

  it('blocks a call with no microphone', () => {
    // Checked BEFORE ringing: discovering it afterwards wastes the callee's
    // time and looks like a fault at their end.
    const failure: CaptureFailure | null = canStartCall({ microphones: [], cameras: [cam], speakers: [] }, false);

    expect(failure?.kind).toBe('no-device');
  });

  it('blocks a video call with no camera, and says audio is still possible', () => {
    const failure: CaptureFailure | null = canStartCall({ microphones: [mic], cameras: [], speakers: [] }, true);

    expect(failure?.kind).toBe('no-device');
    expect(failure?.message).toMatch(/audio call/i);
  });

  it('allows an audio call with no camera', () => {
    expect(canStartCall({ microphones: [mic], cameras: [], speakers: [] }, false)).toBeNull();
  });

  it('allows a video call with both', () => {
    expect(canStartCall({ microphones: [mic], cameras: [cam], speakers: [] }, true)).toBeNull();
  });
});

describe('stopStream', () => {
  it('stops every track, which is what turns the camera light off', () => {
    const stop: ReturnType<typeof vi.fn> = vi.fn();
    const stream: MediaStream = {
      getTracks: () => [{ stop }, { stop }],
    } as unknown as MediaStream;

    stopStream(stream);

    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('tolerates a null stream', () => {
    expect(() => stopStream(null)).not.toThrow();
  });
});
