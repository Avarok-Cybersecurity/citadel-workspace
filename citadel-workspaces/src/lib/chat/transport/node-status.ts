/**
 * A node channel's status port: who is typing, both ways.
 *
 * The server relays a typing notice and stores nothing, so how long a name stays up is decided
 * here: longer than the gap between a steady typist's notices, so the line does not flicker, and
 * gone at once when that member's message arrives. The reader's own typing goes out at most every
 * `TYPING_SEND_GAP_MS`, which stays above the server's limit (3 s per session): a refusal arrives
 * as an `Error` that a concurrent send would take as its own answer (group-chat-signals).
 *
 * The channel's link is the workspace connection, which every request already rides, so the
 * port reports it connected; presence is the roster's, shown by the channel header.
 */
import type { Clock } from '@/lib/cdoc/collab/ports';
import { notifyEach } from '@/lib/notify-listeners';
import type { StatusChange, StatusPort, StatusProbe, StatusSnapshot } from './chat-transport';

export const TYPING_SEND_GAP_MS: number = 4_000;
/** Longer than the send gap, so a steady typist stays named between notices. */
export const TYPING_SHOWN_MS: number = 6_000;
/** How often the composer's text is looked at while it has focus. */
const TYPING_POLL_MS: number = 1_000;

export interface NodeStatusParams {
  readonly clock: Clock;
  /** Sends one typing notice; failures are the caller's to report. */
  readonly sendTyping: () => void;
  /** Whether the reader lets others see them typing (the privacy setting). */
  readonly showsTyping: () => boolean;
  /** The username the server names the reader by, whose own notices are not shown. */
  readonly selfUsername: string | null;
  readonly nameOf: (member: string) => string;
  /**
   * Listens, while the pane does, for members' typing notices (`heard`) and their messages
   * (`wrote`: they are no longer typing it); returns the stop.
   */
  readonly listen: (heard: (member: string) => void, wrote: (member: string) => void) => () => void;
}

export function nodeStatus({ clock, sendTyping, showsTyping, selfUsername, nameOf, listen }: NodeStatusParams): StatusPort {
  const shown: Map<string, () => void> = new Map();
  const listeners: Set<(change: StatusChange) => void> = new Set();
  const names = (): string[] => [...shown.keys()].map(nameOf);
  const changed = (): void => notifyEach(listeners, 'node typing', { kind: 'typing', typing: names() });
  const drop = (member: string): void => {
    const cancel: (() => void) | undefined = shown.get(member);
    if (cancel === undefined) return;
    cancel();
    shown.delete(member);
    changed();
  };

  let polling: (() => void) | null = null;
  let lastText: string = '';
  let lastSent: number = Number.NEGATIVE_INFINITY;
  const tick = (currentText: () => string): void => {
    polling = clock.after(TYPING_POLL_MS, (): void => tick(currentText));
    const text: string = currentText();
    const typed: boolean = text.trim() !== '' && text !== lastText;
    lastText = text;
    if (!typed || !showsTyping() || clock.now() - lastSent < TYPING_SEND_GAP_MS) return;
    lastSent = clock.now();
    sendTyping();
  };

  const heard = (member: string): void => {
    if (member === selfUsername) return;
    const isNew: boolean = !shown.has(member);
    shown.get(member)?.();
    shown.set(member, clock.after(TYPING_SHOWN_MS, (): void => drop(member)));
    if (isNew) changed();
  };
  let stopListening: () => void = (): void => undefined;

  return {
    snapshot: (): StatusSnapshot => ({ connected: true, presence: null, typing: names() }),
    probe: async (): Promise<StatusProbe> => ({ connected: true, presence: null }),
    subscribe: (listener: (change: StatusChange) => void): (() => void) => {
      if (listeners.size === 0) stopListening = listen(heard, drop);
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopListening();
        for (const cancel of shown.values()) cancel();
        shown.clear();
      };
    },
    startTyping: (currentText: () => string): void => {
      polling?.();
      // A draft already in the box when it takes focus is not typing; a change to it is.
      lastText = currentText();
      tick(currentText);
    },
    stopTyping: (): void => { polling?.(); polling = null; },
    acceptance: null,
  };
}
