/**
 * Recording where this session is, for the next time it is claimed.
 *
 * An in-tab refresh keeps its place because the URL is the state. The second
 * session — landing page → Active Sessions → claim — navigated to the workspace
 * root with no params, so somebody who closed the browser mid-conversation came
 * back tomorrow and landed on the default office, re-finding it by hand.
 *
 * Written on every location change rather than on unload: `beforeunload` is not
 * reliably delivered on mobile or on a crash, and those are exactly the closes
 * that end a session without warning.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { connectionManager } from '@/lib/connection';
import { rememberLocation } from '@/lib/sessions/last-location';

export function useRememberLocation(): void {
  const location: ReturnType<typeof useLocation> = useLocation();

  useEffect(() => {
    const cid: bigint | undefined = connectionManager.getConnectionInfo()?.cid;
    // No CID means no session to attribute this to — during boot, or on a
    // follower tab before it has one. Recording under a wrong key would send
    // somebody else back here.
    if (!cid) return;

    rememberLocation(cid, `${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);
}
