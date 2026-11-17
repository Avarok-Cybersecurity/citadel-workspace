/**
 * The two-tone chime a notification plays.
 *
 * Split out of `service.ts` when that file crossed the 250-line ceiling by two
 * lines. The only behavioral change since the move: ONE AudioContext for the
 * module's lifetime. Browsers cap live contexts (Chromium at about six), so
 * constructing a fresh one per chime — and never closing it — exhausted the
 * cap after a handful of notifications; from then on the constructor threw
 * into the bare catch below and sound died silently for the rest of the
 * session.
 */
let sharedContext: AudioContext | null = null;

function chimeContext(): AudioContext {
  if (sharedContext === null || sharedContext.state === 'closed') {
    // Safari's prefixed constructor, named rather than cast through `any`.
    const withWebkit: Window & { webkitAudioContext?: typeof AudioContext } =
      window as Window & { webkitAudioContext?: typeof AudioContext };
    sharedContext = new (window.AudioContext || withWebkit.webkitAudioContext!)();
  }
  return sharedContext;
}

export function playNotificationChime(): void {
  try {
    const ctx: AudioContext = chimeContext();
    const oscillator: OscillatorNode = ctx.createOscillator();
    const gain: GainNode = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available
  }
}
