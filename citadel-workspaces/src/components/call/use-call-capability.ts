import { useEffect, useRef, useState , type MutableRefObject } from 'react';
import { toast } from 'sonner';
import { callOutcomeMessage, callOutcomePeerName } from '@/lib/call/call-outcome-message';
import type { CallState } from '@/lib/call/call-state';

/**
 * Whether calling is possible here, and telling the caller how a call ended.
 *
 * Extracted from CallProvider to keep it under the file cap. Both concerns are
 * "what do we say to the user about calling", and both were places the UI went
 * quiet: the probe could sit on "Checking…" for ever, and every non-connecting
 * outcome presented as the panel silently vanishing.
 */
export function useCallCapability({
  call,
}: {
  call: CallState | null;
}): { capability: { supported: boolean; reason?: string } } {
  // Once per call: the terminal state survives teardown, so this would
  // otherwise re-fire on every later render.
  const announcedOutcome: MutableRefObject<string | null> = useRef<string | null>(null);
  useEffect(() => {
    if (!call || call.status !== 'ended') return;
    // Only the caller is left guessing; the callee knows what they pressed.
    if (!call.outgoing) return;
    if (announcedOutcome.current === call.callId) return;

    const message: string | null = callOutcomeMessage(call.reason, callOutcomePeerName(call));
    if (!message) return;
    announcedOutcome.current = call.callId;
    toast(message);
  }, [call]);

  // Whether THIS browser can call, and nothing about which tab this is: a call
  // lives in the tab whose session is in it, and a tab without the socket
  // relays its frames to the one with it (media-frame-relay.ts).
  const [capability, setBrowserCapability] = useState<{ supported: boolean; reason?: string }>({
    supported: false,
    reason: 'Checking whether this browser supports calls…',
  });

  useEffect(() => {
    let cancelled: boolean = false;
    // Imported on demand, like the session below: the probe lives in
    // codec-support, which drags the whole codec table in with it.
    void import('@/lib/call/codec-support')
      .then((m) => m.probeMediaCapabilities())
      .then((report) => {
        if (!cancelled) setBrowserCapability({ supported: report.supported, reason: report.reason });
      })
      .catch(() => {
        // Without this the initial "Checking…" was permanent: a redeploy that
        // invalidated this chunk's hash left the buttons disabled behind a
        // tooltip claiming a check was still running.
        if (!cancelled) {
          setBrowserCapability({
            supported: false,
            reason: 'Could not load calling support. Reload the page to try again.',
          });
        }
      });
    return (): void => {
      cancelled = true;
    };
  }, []);


  return { capability };
}
