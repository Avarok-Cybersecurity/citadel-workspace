import { ScreenPump } from './capture-pump';

/**
 * One tab's outgoing screen share.
 *
 * Split out of `CallSession`, which was at its length ceiling and had no
 * business holding this: a share starts and stops many times inside a call that
 * has one camera and one microphone for its whole life, so its lifecycle is
 * genuinely separate.
 *
 * Everything here is about STOPPING properly. Starting a share is one call to
 * the browser; stopping it has four parts, and missing any one of them leaves
 * something running that the user believes they turned off.
 */
export class ScreenShare {
  private pump: ScreenPump | null = null;
  private stream: MediaStream | null = null;

  constructor(
    private readonly onFrame: (frame: VideoFrame) => void,
    private readonly onEncoderClose: () => void,
  ) {}

  /**
   * Begin sharing a screen that has already been captured.
   *
   * The stream is passed in rather than requested here: `getDisplayMedia` must
   * be called from a user gesture, and this runs several awaits deep inside the
   * call machinery, where the gesture is long gone.
   *
   * `onEnded` fires when the user stops the share from the browser's own bar --
   * a control this app does not own and cannot hide. Without it the button
   * would still read "sharing" over a track that had stopped, and peers would
   * keep a stage open on a frozen last frame.
   */
  start(stream: MediaStream, onEnded: () => void): boolean {
    this.stop();
    const track: MediaStreamTrack | undefined = stream.getVideoTracks()[0];
    if (!track) return false;

    this.stream = stream;
    track.addEventListener('ended', onEnded, { once: true });

    this.pump = new ScreenPump(this.onFrame);
    this.pump.start(stream);
    return true;
  }

  /** The screen this tab is sharing, for the local preview. */
  getStream(): MediaStream | null {
    return this.stream;
  }

  stop(): void {
    this.pump?.stop();
    this.pump = null;
    // The tracks too, or the browser's "sharing" indicator stays up after the
    // app has stopped sending -- which reads as "it is still watching my
    // screen", and on a product that sells privacy that is the worst possible
    // thing to be wrong about.
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.onEncoderClose();
  }
}
