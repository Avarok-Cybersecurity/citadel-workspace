/**
 * What a person is told when a peer message will not send.
 *
 * `describeFailure` prefers the real reason over a fixed "Please try again",
 * and that was the right fix -- it let a user tell a permanent refusal from a
 * retryable one. But it does not TRANSLATE, so the P2P paths hand the transport's
 * own words to a toast. Those words are:
 *
 *   No messaging handle found for local CID: 13069842581551822719.
 *   Call open_p2p_connection first.
 *   Not initialized. Call init() first.
 *   WebSocket client not available (leader without client)
 *
 * A nineteen-digit CID, two function names, and "leader" -- an internal
 * multi-tab role the product never mentions. `call-failure-detail.ts` exists
 * because CI caught exactly this on the call path and it was fixed there. The
 * messaging and file-transfer paths were never given the same treatment.
 *
 * The raw text is kept alongside the translation, as the call module does: a
 * generic "something went wrong" would be worse, because at least the raw
 * string can be searched for.
 */
import { describe, it, expect } from 'vitest';
import { peerFailureDetail, failureDescription, type PeerFailureDetail } from '../peer-failure-detail';

describe('a peer transport failure', () => {
  it('does not show the messenger handle error, or the CID in it', () => {
    const shown: PeerFailureDetail = peerFailureDetail(
      'No messaging handle found for local CID: 13069842581551822719. Call open_p2p_connection first.',
    );

    expect(shown.recognised).toBe(true);
    expect(shown.detail).not.toMatch(/13069842581551822719/);
    expect(shown.detail).not.toMatch(/open_p2p_connection/);
    expect(shown.detail).toMatch(/connect/i);
    // Kept for whoever is debugging, exactly as the call translator does.
    expect(shown.raw).toMatch(/open_p2p_connection/);
  });

  it('does not tell anybody to call init()', () => {
    const shown: PeerFailureDetail = peerFailureDetail('Not initialized. Call init() first.');

    expect(shown.recognised).toBe(true);
    expect(shown.detail).not.toMatch(/init\(\)/);
  });

  it('does not mention the leader tab, which the product never names', () => {
    const shown: PeerFailureDetail = peerFailureDetail(
      'WebSocket client not available (leader without client)',
    );

    expect(shown.recognised).toBe(true);
    expect(shown.detail).not.toMatch(/leader/i);
  });

  it('says a storage timeout is about this device, not the peer', () => {
    const shown: PeerFailureDetail = peerFailureDetail('LocalDBSetKV request timed out');

    expect(shown.recognised).toBe(true);
    expect(shown.detail).toMatch(/device/i);
  });

  it('passes an already-human message through unchanged', () => {
    // Negative control. Round 462 made this one plain English on purpose, and a
    // translator that rewrote it would be undoing that work.
    const message: string = 'the connection to the Citadel agent was lost';
    const shown: PeerFailureDetail = peerFailureDetail(message);

    expect(shown.recognised).toBe(false);
    expect(shown.detail).toBe(message);
  });

  it('says what was attempted when there is no message at all', () => {
    const shown: PeerFailureDetail = peerFailureDetail('');

    expect(shown.detail).not.toBe('');
    expect(shown.recognised).toBe(false);
  });
});

/**
 * The helper the seven toast sites actually call.
 *
 * A hook-level test was attempted first and abandoned: driving `useP2PMessages`
 * needed a stub for every method it touches on mount, and the mock kept growing
 * without the assertion getting any stronger. Per this repo's rule on
 * minimising mocks, the seam moved instead — the seven sites now share one
 * expression, and that expression is tested here.
 */
describe('the description a toast is given', () => {
  it('translates a transport error rather than passing it through', () => {
    const shown: string = failureDescription(
      new Error('No messaging handle found for local CID: 13069842581551822719.'),
      'Please try again.',
    );

    expect(shown).toBe(peerFailureDetail('No messaging handle found for local CID: 13069842581551822719.').detail);
    expect(shown).not.toMatch(/13069842581551822719/);
  });

  it('uses the site fallback for a thrown non-Error, which carries nothing to translate', () => {
    // A thrown string or {message} carries the reason (the WASM client throws both); it is
    // translated like an Error's message rather than replaced by the generic fallback.
    expect(failureDescription('a string, not an Error', 'Check your connection.')).toBe(peerFailureDetail('a string, not an Error').detail);
    expect(failureDescription({ message: 'Peer connection not found' }, 'Check your connection.')).toBe(peerFailureDetail('Peer connection not found').detail);
    expect(failureDescription({ code: 42 }, 'Check your connection.')).toBe('Check your connection.');
    expect(failureDescription(undefined, 'Please try again.')).toBe('Please try again.');
  });

  it('keeps each site fallback distinct', () => {
    // The file-transfer sites say something different from the message sites,
    // and collapsing them into one sentence would lose that.
    expect(failureDescription(null, 'Check your connection and try again.'))
      .not.toBe(failureDescription(null, 'Please try again.'));
  });
});
