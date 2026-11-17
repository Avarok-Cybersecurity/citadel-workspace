/**
 * Who is signed in on THIS tab, for components that render their name.
 *
 * The lookup order is `tabIdentity`'s and the reason is recorded there: the
 * tab's selection first, the saved account second. What this adds is the
 * asynchronous read, which `BaseOffice` and `GroupChatPage` were each about to
 * spell out by hand — and a hand-spelled copy of an ordering that matters is
 * how the ordering drifts.
 *
 * Returns `null` until the read lands. Callers should render something during
 * that, not nothing: `GroupChatPage` gated its entire chat area on an identity
 * lookup and showed an empty page whenever the lookup came back empty.
 */
import { useState, useEffect } from 'react';
import { getSelectedUser, type TabUserContext } from '@/lib/tab-context';
import { connectionManager } from '@/lib/connection';
import { tabIdentity, type TabIdentity } from '@/lib/tab-identity';
import type { StoredSession } from '@/types/session-types';
import { runAsyncSetup } from '@/lib/utils/async-utils';

/** Who is signed in on this tab now: read when asked, so a sign-in after mount is seen. */
export async function readTabIdentity(): Promise<TabIdentity> {
  const selection: TabUserContext | null = await getSelectedUser();
  const session: StoredSession | null = await connectionManager.getTabSelectedSession();
  return tabIdentity(selection, session);
}

export function useTabIdentity(): TabIdentity | null {
  const [identity, setIdentity] = useState<TabIdentity | null>(null);

  useEffect(() => {
    let cancelled: boolean = false;
    runAsyncSetup(async () => {
      const identity: TabIdentity = await readTabIdentity();
      if (!cancelled) setIdentity(identity);
    });
    return (): void => { cancelled = true; };
  }, []);

  return identity;
}
