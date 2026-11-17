/**
 * A message arriving for a session you are not looking at has to be noticeable.
 *
 * The Active Sessions strip renders a glow — `shouldGlow` on
 * `OrphanSessionIcon`, driven by `glowingSessionCid`, set by `triggerGlow`.
 * Nothing ever called `triggerGlow`. The badge number moved and the attention
 * cue the icon was built for never fired: the whole path existed except the one
 * line that starts it.
 */
import { describe, it, expect } from 'vitest';
import { sessionsThatRose } from '../unread-rose';

describe('sessionsThatRose', () => {
  it('names the session whose count went up', () => {
    const before: Map<string, number> = new Map([['a', 1], ['b', 0]]);
    const after: Map<string, number> = new Map([['a', 1], ['b', 3]]);
    expect(sessionsThatRose(before, after)).toEqual(['b']);
  });

  it('says nothing when a count falls, which is somebody reading them', () => {
    const before: Map<string, number> = new Map([['a', 5]]);
    const after: Map<string, number> = new Map([['a', 0]]);
    expect(sessionsThatRose(before, after)).toEqual([]);
  });

  it('does not light every session on the first snapshot', () => {
    // The strip mounts with an empty map, and the first event carries every
    // session's current count. Treating an absent previous as zero would glow
    // all of them at once the moment the page loads.
    const after: Map<string, number> = new Map([['a', 4], ['b', 2]]);
    expect(sessionsThatRose(new Map(), after)).toEqual([]);
  });

  it('ignores a session that has gone away', () => {
    const before: Map<string, number> = new Map([['a', 1], ['gone', 9]]);
    const after: Map<string, number> = new Map([['a', 2]]);
    expect(sessionsThatRose(before, after)).toEqual(['a']);
  });
});
