/**
 * What to show a person when a call could not start.
 *
 * `CallState.reason` for a `failed` call is whatever the media transport threw,
 * and that went straight into an alert. CI caught what that looks like:
 *
 *   The call could not start
 *   no UDP channel for peer 2181040939592097811 within 5s; it may still be
 *   negotiating (retry shortly), or the peer connection was established with
 *   UdpMode disabled
 *
 * A nineteen-digit CID, an internal mode name, and a parenthetical addressed to
 * whoever wrote the retry policy — in a `role="alert"`, which a screen reader
 * reads out in full. There is nothing in it a user can act on, and the one
 * thing they CAN do about it — wait a moment and call again — is buried in a
 * clause that reads like an aside to somebody else.
 *
 * Unrecognised text is passed through unchanged. A generic "something went
 * wrong" would be worse than the raw string: at least the raw string can be
 * searched for. The raw text is kept alongside the translation either way, so
 * nothing is lost to whoever is debugging.
 */

import { LOST_ON_TAKEOVER } from './lost-on-takeover';

export interface CallFailureDetail {
  /** What the user is told. */
  detail: string;
  /** What the transport actually said, for the DOM and for support. */
  raw: string;
  /** Whether this build recognised the failure. */
  recognised: boolean;
}

/**
 * The media path could not be negotiated. The service's own message says this
 * "may still be negotiating (retry shortly)", which is the actionable half.
 */
const NO_MEDIA_PATH: RegExp = /no UDP channel|UdpMode disabled|udp channel ended/i;

/** The peer's client answered but could not agree on a codec. */
const NO_CODEC: RegExp = /no (?:shared |common )?codec|codec mismatch/i;

/** The heading over a failed call: one cut off mid-call did start. */
export function failedCallTitle(reason: string | null): string {
  return reason === LOST_ON_TAKEOVER ? 'The call was cut off' : 'The call could not start';
}

export function callFailureDetail(reason: string | null): CallFailureDetail {
  const raw: string = reason ?? '';

  if (NO_MEDIA_PATH.test(raw)) {
    return {
      detail:
        'A direct media connection could not be opened. This often clears on its own — ' +
        'try the call again in a moment. If it keeps happening, a firewall or VPN may be ' +
        'blocking direct connections.',
      raw,
      recognised: true,
    };
  }

  if (NO_CODEC.test(raw)) {
    return {
      detail: 'The two browsers could not agree on an audio or video format for this call.',
      raw,
      recognised: true,
    };
  }

  return {
    detail: raw === '' ? 'Something went wrong setting up the call.' : raw,
    raw,
    recognised: false,
  };
}
