/**
 * Coming back to where you were.
 *
 * An in-tab refresh keeps its place because the URL is the state. The actual
 * second session — landing page → Active Sessions → claim — navigated to the
 * workspace root with no params, so somebody who closed the browser
 * mid-conversation came back tomorrow, claimed their session, and landed on the
 * default office. They re-found the conversation by hand, every day.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { rememberLocation, readLastLocation, isRestorableLocation } from '../last-location';

describe("a session's last location", () => {
  beforeEach(() => localStorage.clear());

  it('comes back for the session that was there', () => {
    rememberLocation(1n, '/workspace?nodeId=abc');
    expect(readLastLocation(1n)).toBe('/workspace?nodeId=abc');
  });

  it('is per session, not global', () => {
    // Two accounts in one browser is the workflow this app is built around;
    // one returning to the other's conversation would be worse than the
    // default office.
    rememberLocation(1n, '/messages?channel=alice');
    expect(readLastLocation(2n)).toBeNull();
  });

  it('never sends a returning user back to a way IN', () => {
    // Restoring /connect or the landing page returns them to the screen they
    // were trying to get past — the one place this feature must not go.
    for (const path of ['/', '/connect', '/login', '/join']) {
      rememberLocation(3n, path);
      expect(readLastLocation(3n), path).toBeNull();
    }
  });

  it('rejects an unrestorable value on the way out as well as in', () => {
    // Written by an older build, or by hand. Checking only on write would let
    // it become a navigation target.
    localStorage.setItem('session_last_location_4', '/connect');
    expect(readLastLocation(4n)).toBeNull();
  });

  it('has nothing to say about a session that was never here', () => {
    expect(readLastLocation(99n)).toBeNull();
  });

  it('knows which paths are inside the app', () => {
    expect(isRestorableLocation('/workspace?nodeId=x')).toBe(true);
    expect(isRestorableLocation('/messages')).toBe(true);
    expect(isRestorableLocation('/connect')).toBe(false);
    expect(isRestorableLocation('/')).toBe(false);
  });
});
