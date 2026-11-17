/**
 * Which sessions just gained unread messages.
 *
 * The Active Sessions strip renders a glow on a chip — `shouldGlow` on
 * `OrphanSessionIcon`, driven by `glowingSessionCid`, set by `triggerGlow`.
 * Nothing ever called `triggerGlow`. So a message arriving for a session you
 * are not looking at moved its badge number and the attention cue the icon was
 * built to show never fired: the whole path existed except the one line that
 * starts it.
 *
 * A pure comparison, because "did this go up" is the entire decision and it is
 * easier to get wrong than it looks — the first snapshot arrives against an
 * empty map, and treating that as a rise glows every session at once the moment
 * the strip loads.
 */

export function sessionsThatRose(
  previous: ReadonlyMap<string, number>,
  next: ReadonlyMap<string, number>,
): string[] {
  const risen: string[] = [];
  for (const [cid, count] of next) {
    // A cid absent from `previous` is only a rise if we HAD a previous. The
    // caller passes an empty map exactly once, at mount, and every session with
    // unread messages would otherwise announce itself as new.
    const before: number | undefined = previous.get(cid);
    if (before === undefined) continue;
    if (count > before) risen.push(cid);
  }
  return risen;
}

/**
 * How long a chip stays lit.
 *
 * Long enough to catch an eye that was elsewhere, short enough that a strip of
 * permanently glowing chips does not become the normal state and stop meaning
 * anything.
 */
export const GLOW_MS: 4_000 = 4_000;
