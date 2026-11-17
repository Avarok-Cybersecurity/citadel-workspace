import { useEffect, useRef , type RefObject } from 'react';
import { useCall } from '@/lib/call/call-context';

/**
 * Where remote call audio actually plays.
 *
 * The only `<audio>` element used to live inside `ParticipantTile`, which mounts
 * only in the conversation the call belongs to. Navigating to another chat, the
 * file manager or the directory unmounted every tile — so the peer's audio
 * stopped instantly while the microphone kept transmitting, and nothing on
 * screen said the user was still in a call. They went deaf, stayed audible, and
 * had no way to hang up.
 *
 * This lives under `CallLayer`, above the router, so it is mounted for the whole
 * session and the audio is independent of what the user is looking at.
 */
export function CallAudioHost(): JSX.Element {
  const { remoteAudioStreams } = useCall();

  return (
    <>
      {[...remoteAudioStreams.entries()].map(([cid, stream]) => (
        <RemoteAudio key={cid.toString()} stream={stream} />
      ))}
    </>
  );
}

function RemoteAudio({ stream }: { stream: MediaStream }): JSX.Element {
  const ref: RefObject<HTMLAudioElement> = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element: HTMLAudioElement | null = ref.current;
    if (!element) return;
    element.srcObject = stream;
    // Autoplay can be refused before the user has interacted with the page.
    // They are in a call, so they have — but a refusal must not throw into the
    // render path either way.
    void element.play().catch(() => undefined);
    return (): void => {
      element.srcObject = null;
    };
  }, [stream]);

  /* The element IS the speaker: decoded remote audio lands in a MediaStream,
     and a stream attached to nothing plays nowhere. It renders nothing. */
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio ref={ref} autoPlay className="hidden" aria-hidden="true" />;
}
