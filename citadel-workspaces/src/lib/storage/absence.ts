/**
 * Did a LocalDB read come back empty because the key genuinely is not there?
 *
 * The distinction is load-bearing, not pedantry. `sendLocalDBGet` rejects for
 * BOTH "no such key" and "the request timed out after 5s" / "the socket is
 * down" — and every caller that treats a rejection as "nothing stored yet" then
 * acts on a conclusion it has not earned:
 *
 *  - the message store fabricates metadata with `latestPage: 0` and writes a
 *    page containing the one message that triggered it, overwriting page 0 and
 *    orphaning pages 1..N. One transient timeout destroys a conversation.
 *  - the auto-connect service returns its default of `enabled: true`, which
 *    silently turns a preference back on for somebody who turned it off.
 *
 * This predicate was written once, inside `message-page-operations`, with that
 * first paragraph as its comment. The same string test was then spelled out by
 * hand in `message-pagination-store` (twice), in `p2p-registration-service`,
 * and nowhere at all in `server-auto-connect-service` — which is how the
 * preference case stayed broken. One copy now, and a test that refuses a sixth.
 */
export function isGenuinelyAbsent(error: unknown): boolean {
  const message: string = error instanceof Error ? error.message : String(error);
  return message.includes('Key not found') || message.includes('No keys found');
}
