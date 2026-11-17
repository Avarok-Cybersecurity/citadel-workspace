/**
 * The alert a user reads when a call fails must be addressed to them.
 *
 * CI's screen-share run failed with this on screen, in a `role="alert"`:
 *
 *   no UDP channel for peer 2181040939592097811 within 5s; it may still be
 *   negotiating (retry shortly), or the peer connection was established with
 *   UdpMode disabled
 */
import { describe, it, expect } from 'vitest';
import { callFailureDetail, type CallFailureDetail } from '../call-failure-detail';

const UDP: string =
  'no UDP channel for peer 2181040939592097811 within 5s; it may still be negotiating ' +
  '(retry shortly), or the peer connection was established with UdpMode disabled';

describe('what a failed call says', () => {
  it('does not put a CID or an internal mode name in front of the user', () => {
    const shown: CallFailureDetail = callFailureDetail(UDP);

    expect(shown.detail).not.toContain('2181040939592097811');
    expect(shown.detail).not.toMatch(/UdpMode/i);
    expect(shown.detail).not.toMatch(/\d{10,}/);
  });

  it('says the one thing the user can do, which the raw text buries in an aside', () => {
    expect(callFailureDetail(UDP).detail).toMatch(/try the call again/i);
  });

  it('keeps the raw text, so nothing is lost to whoever is debugging', () => {
    expect(callFailureDetail(UDP).raw).toBe(UDP);
  });

  it('passes an unrecognised failure through unchanged', () => {
    // The negative control, and the point of PCND here: a generic sentence
    // would be worse than the raw string, because the raw string can at least
    // be searched for. If this build does not know the failure, it says so by
    // showing it.
    const odd: string = 'the flux capacitor declined';
    const shown: CallFailureDetail = callFailureDetail(odd);

    expect(shown.detail).toBe(odd);
    expect(shown.recognised).toBe(false);
  });

  it('has something to say when the transport said nothing at all', () => {
    expect(callFailureDetail(null).detail).toBe('Something went wrong setting up the call.');
    expect(callFailureDetail(null).recognised).toBe(false);
  });

  it('recognises a codec failure separately, which needs a different answer', () => {
    const shown: CallFailureDetail = callFailureDetail('no shared codec between peers');

    expect(shown.recognised).toBe(true);
    expect(shown.detail).toMatch(/audio or video format/i);
    expect(shown.detail).not.toMatch(/try the call again/i);
  });
});
