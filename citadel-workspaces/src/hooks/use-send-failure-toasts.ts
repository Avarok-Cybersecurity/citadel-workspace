/**
 * Show the user that a message did not go out.
 *
 * `lib/p2p/send-failure.ts` recognises the agent's `MessageSendFailure`,
 * builds a reason a person can act on, throttles repeats per peer, and emits
 * `p2p:send-failed` — described in its own comment as "an event a surface can
 * render". No surface rendered it. Only tests subscribed.
 *
 * So a P2P message that failed to send was detected, explained and throttled,
 * and then shown to nobody: the message sat in the thread looking sent.
 *
 * This is the second half of the fix the sibling test already named — its
 * header says "The consumer has to be WIRED, not merely written", about the
 * WebSocket handler calling the reader. The handler was wired; the surface was
 * not. Both ends have to exist, and this repository keeps finding features
 * where only one does.
 *
 * The subscription lives in a hook rather than in `send-failure.ts` because
 * that module is business logic: it decides what counts as a failure and how
 * often to speak, and it must not also decide how to draw. Keeping the toast
 * here is what lets the throttle be unit-tested with no DOM.
 */
import { useEffect } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { toast } from '@/hooks/use-toast';

interface SendFailedEvent {
  cid?: bigint;
  reason: string;
}

export function useSendFailureToasts(): void {
  useEffect((): (() => void) => {
    const unsubscribe: () => void = eventEmitter.on(
      'p2p:send-failed',
      (event: SendFailedEvent): void => {
        toast({
          title: 'Message not sent',
          description: event.reason,
          variant: 'destructive',
        });
      },
    );
    return unsubscribe;
  }, []);
}
