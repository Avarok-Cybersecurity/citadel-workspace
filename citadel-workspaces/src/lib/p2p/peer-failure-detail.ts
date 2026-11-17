import { describeFailure } from '@/lib/failure-message';
/**
 * What to tell a person when a message to a peer will not send.
 *
 * `describeFailure` prefers the transport's real reason over a fixed "Please
 * try again", and that was right: it lets a user tell a permanent refusal from
 * a retryable one. It does not TRANSLATE, though, so what reaches the toast is
 * the transport's own words:
 *
 *   No messaging handle found for local CID: 13069842581551822719.
 *   Call open_p2p_connection first.
 *   Not initialized. Call init() first.
 *   WebSocket client not available (leader without client)
 *
 * A nineteen-digit CID, two function names, and "leader" — an internal
 * multi-tab role this product never mentions anywhere in its interface.
 *
 * `lib/call/call-failure-detail.ts` is the same idea, written after CI caught
 * the call path announcing "UdpMode disabled" to a user. The messaging and
 * file-transfer paths were never given the same treatment. This is deliberately
 * a SEPARATE table rather than an extension of that one: the vocabularies do
 * not overlap — that one is about UDP and codecs, this one about messenger
 * handles and local storage — and a single table matching both would make every
 * future entry a question about which paths it applies to.
 *
 * The raw text is kept beside the translation, as the call module does. A
 * generic "something went wrong" would be worse than the raw string, because at
 * least the raw string can be searched for.
 */

export interface PeerFailureDetail {
  /** What the user is told. */
  detail: string;
  /** What the transport actually said, for the DOM and for support. */
  raw: string;
  /** Whether this build recognised the failure. */
  recognised: boolean;
}

/** The peer channel is not open — the commonest of these by far. */
const NO_CHANNEL: RegExp = /no messaging handle|open_p2p_connection|not connected to (?:this )?peer/i;

/** The WASM client or workspace state has not finished starting. */
const NOT_READY: RegExp = /not initialized|workspace not initialized|call init\(\)/i;

/**
 * The tab that owns the socket could not be reached. "Leader" is an internal
 * role: one browser holds one WebSocket and the other tabs proxy through it.
 */
const NO_LEADER: RegExp = /leader without client|websocket client not available|leader failed to/i;

/** A local write, not a network one. Saying "peer" here would misdirect. */
const LOCAL_STORAGE: RegExp = /localdb\w*\s+request timed out|localdb(?:set|get)kv/i;

export function peerFailureDetail(reason: string | null): PeerFailureDetail {
  const raw: string = reason ?? '';

  if (NO_CHANNEL.test(raw)) {
    return {
      detail:
        'You are not connected to this peer yet. This usually clears on its own once ' +
        'the connection finishes opening — try again in a moment.',
      raw,
      recognised: true,
    };
  }

  if (NOT_READY.test(raw)) {
    return {
      detail: 'This tab is still starting up. Try again in a moment, or reload the page.',
      raw,
      recognised: true,
    };
  }

  if (NO_LEADER.test(raw)) {
    return {
      detail:
        'This tab could not reach the connection it shares with your other tabs. ' +
        'Reloading this page usually restores it.',
      raw,
      recognised: true,
    };
  }

  if (LOCAL_STORAGE.test(raw)) {
    return {
      detail:
        'This device could not save the message. It was not sent, so nothing has reached ' +
        'your peer — try again.',
      raw,
      recognised: true,
    };
  }

  return {
    detail: raw === '' ? 'The message could not be sent.' : raw,
    raw,
    recognised: false,
  };
}

/**
 * The description a P2P failure toast should carry.
 *
 * Every call site had the same ternary — `error instanceof Error ?
 * error.message : 'Please try again.'` — seven times over, and translating the
 * message meant editing that expression seven times. One of the seven had
 * already drifted to a different fallback. This is the one place the shape
 * lives, so the next entry in the table above reaches all of them.
 *
 * `fallback` stays per-site on purpose: "Check your connection and try again"
 * is right for a file transfer and wrong for a message edit, and a thrown
 * non-Error carries nothing to translate.
 */
export function failureDescription(error: unknown, fallback: string): string {
  // describeFailure extracts a message from any thrown shape (Error, string, {message});
  // what it cannot read stays the site's fallback, untranslated.
  const message: string = describeFailure(error, '');
  return message ? peerFailureDetail(message).detail : fallback;
}
