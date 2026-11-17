import { debugLog } from '@/lib/debug-config';
import { useEffect, useRef , type MutableRefObject } from 'react';
import { useCall } from '@/lib/call/call-context';
import type { CallStatus } from '@/lib/call/call-state';
import type { CallSoundPlayer } from '@/lib/call/call-sounds';

/** Lazy so the audio code never rides along with the app shell (see below). */
type SoundModule = typeof import('@/lib/call/call-sounds');

/**
 * Turns call state transitions into sound, and renders nothing.
 *
 * Sound reacts to the same reducer state the visuals react to, rather than to
 * the actions that caused it — so a decline arriving over the wire silences
 * the ring exactly as pressing Decline does, with no second code path.
 *
 * The sound module is imported on demand: no call has ever been placed on the
 * landing page, and the bundle budget there is nearly spent. Because dynamic
 * imports of the same module resolve in registration order, transitions are
 * applied to the player in the order they happened even while the first
 * import is still in flight.
 */
export function CallSoundEffects(): null {
  const { call } = useCall();
  const status: CallStatus | null = call?.status ?? null;
  const callId: string | null = call?.callId ?? null;
  const prevStatusRef: MutableRefObject<CallStatus | null> = useRef<CallStatus | null>(null);
  const loadedRef: MutableRefObject<boolean> = useRef(false);

  useEffect(() => {
    const prev: CallStatus | null = prevStatusRef.current;
    prevStatusRef.current = status;
    // Nothing has happened and nothing needs stopping: leave the module unloaded.
    if (status === null && prev === null) return;

    loadedRef.current = true;
    void import('@/lib/call/call-sounds')
      .then(({ callSounds }: SoundModule) => {
        const player: CallSoundPlayer = callSounds();
        if (status === 'ringing-in' && callId) {
          void player.startRing('incoming', callId);
        } else if (status === 'ringing-out' && callId) {
          void player.startRing('ringback', callId);
        } else {
          // Accept, decline, timeout, failure, hangup: the ring stops NOW.
          player.stopRing();
          if (status === 'active' && prev !== 'active') player.chime('connected');
          const wasLive: boolean = prev === 'active' || prev === 'connecting';
          if (wasLive && (status === null || status === 'ended' || status === 'failed')) {
            player.chime('ended');
          }
        }
      })
      .catch(() => {
        // No sound is an acceptable outcome; a broken call is not.
      });
  }, [status, callId]);

  // A ring must not outlive the surface that owns it (e.g. logout mid-ring).
  useEffect(
    () => (): void => {
      if (!loadedRef.current) return;
      void import('@/lib/call/call-sounds')
        .then(({ callSounds }: SoundModule) => callSounds().stopRing())
        // Logged, not swallowed: if this fails the ringtone keeps playing and
        // nothing anywhere says why.
        .catch((error: unknown) => debugLog('CallSoundEffects', 'stopRing failed', error));
    },
    [],
  );

  return null;
}
