import { useEffect, useState } from 'react';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { Button } from '@/components/ui/button';
import { Phone, PhoneOff, Video } from 'lucide-react';
import type { CallMediaKinds } from '@/types/p2p-commands';

interface IncomingCallCardProps {
  callerName: string;
  /** Who to fetch the picture for; the name stands in when the caller is not in the roster. */
  callerUsername?: string;
  media: CallMediaKinds;
  /** Room name for a group call; absent for 1:1. */
  roomName?: string | null;
  onAccept: (media: CallMediaKinds) => void;
  onDecline: () => void;
}

/**
 * A ringing call, shown wherever the user happens to be in the app.
 *
 * Not a toast and not a modal, deliberately. Toasts auto-dismiss and stack,
 * and a ringing call must persist and be singular. A modal would trap focus and
 * block the app for something the user may quite reasonably want to ignore.
 *
 * Focus is NOT stolen. Taking focus mid-typing is hostile to everyone and a
 * disaster for a screen-reader user; the card announces itself through a live
 * region instead, and sits first in DOM order after the top bar so it is one
 * Tab away.
 */
export function IncomingCallCard({
  callerName,
  callerUsername,
  media,
  roomName,
  onAccept,
  onDecline,
}: IncomingCallCardProps): JSX.Element {
  const kind: "video" | "audio" = media.video ? 'video' : 'audio';
  const description: string = roomName
    ? `Incoming ${kind} call in ${roomName}`
    : `Incoming ${kind} call`;

  // The card's own comment says it "announces itself through a live region
  // instead" of taking focus. There was no live region anywhere in the call
  // path — `role="group"` is inserted silently — so a screen-reader user with
  // call sounds turned off was told nothing at all, for the full 45s ring.
  //
  // Populated in an effect rather than rendered with its text already present:
  // a live region that mounts WITH content is frequently not announced, because
  // assistive technology watches it for changes.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const message: string = `${description} from ${callerName}. Press Tab to reach Decline and Accept.`;
    const id: number = window.setTimeout(() => setAnnouncement(message), 100);
    return (): void => window.clearTimeout(id);
  }, [description, callerName]);

  return (
    <div
      role="group"
      aria-label={`${description} from ${callerName}`}
      data-testid="incoming-call-card"
      // pointer-events-auto is load-bearing. Every Radix layer sets
      // `body { pointer-events: none }` while it is open, and this card lives
      // outside the portal — so with Settings, Chat Settings, a file dialog or
      // any dropdown open, the card painted on top (z-60 over z-50) and Accept
      // and Decline did nothing. A ringing call that looks answerable and is
      // not is the worst failure a calling feature has.
      className="pointer-events-auto fixed inset-x-3 top-16 z-[60] rounded-lg border border-border bg-popover p-4 shadow-xl motion-safe:animate-fade-in sm:inset-x-auto sm:right-4 sm:w-80"
    >
      {/* Assertive: a ring is time-limited, so a polite queue can outlast it. */}
      <span
        role="alert"
        aria-live="assertive"
        data-testid="incoming-call-announcement"
        className="sr-only"
      >
        {announcement}
      </span>
      <div className="flex items-center gap-3">
        {/* Halo rings radiating from the caller, not a whole-avatar opacity
            blink: the motion says "ringing" instead of "loading". Under
            reduced motion the static accent ring alone carries the state. */}
        <div className="relative shrink-0">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-2 border-primary-accent motion-safe:animate-ring-pulse"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-2 border-primary-accent motion-safe:animate-ring-pulse motion-safe:[animation-delay:1.2s]"
          />
          <MemberAvatar username={callerUsername ?? callerName} name={callerName} className="h-12 w-12 text-sm ring-2 ring-primary-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-popover-foreground">{callerName}</p>
          {/* The same words are also in the assertive live region above, so
              both carry a testid: a spec matching on the TEXT resolves to two
              elements and fails on strict mode, which is a real ambiguity
              rather than a flake. */}
          <p data-testid="incoming-call-kind" className="truncate text-sm text-muted-foreground">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {/* Decline is FIRST in DOM order though it sits left visually: a blind
            Tab-then-Enter reflex should not answer a call by accident. */}
        <Button
          variant="destructive"
          size="sm"
          className="flex-1"
          onClick={onDecline}
          data-testid="incoming-call-decline"
        >
          <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Decline
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={() => onAccept(media)}
          data-testid="incoming-call-accept"
        >
          {media.video ? (
            <Video className="mr-1.5 h-4 w-4" aria-hidden="true" />
          ) : (
            <Phone className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          Accept
        </Button>
      </div>

      {media.video && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-muted-foreground"
          onClick={() => onAccept({ audio: true, video: false, screen: false })}
          data-testid="incoming-call-accept-audio"
        >
          Answer without video
        </Button>
      )}
    </div>
  );
}
