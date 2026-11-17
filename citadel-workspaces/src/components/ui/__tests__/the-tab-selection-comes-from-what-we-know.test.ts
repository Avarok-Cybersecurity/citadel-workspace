/**
 * Recording which account a tab is using must not depend on a network answer.
 *
 * `use-auto-claim-session` asked the internal service for the active-session
 * list and searched it for the CID it was ALREADY CONNECTED WITH, to recover a
 * username and a server address the connection record usually holds. It asked
 * through `getActiveSessions`, which returns an empty array when it cannot ask
 * or is not answered — so `find` matched nothing, the selection was never
 * written, and nothing said so.
 *
 * The symptom appears nowhere near the cause. `resolveCurrentUserId` reads the
 * tab selection, so every permission fetch then bails with "nobody is signed in
 * on this tab" and every gated control on the page refuses. Round 328 traced
 * that sentence back out of CI once already.
 */
import { describe, it, expect } from 'vitest';
import { tabSelectionFromConnection, type TabSelection } from '../tab-selection-from-connection';
import type { CurrentConnectionInfo } from '@/lib/connection/types';

describe('who this tab is using', () => {
  it('comes from the connection record when it has the fields', () => {
    const connection: CurrentConnectionInfo = {
      cid: 99n,
      username: 'alice',
      serverAddress: '127.0.0.1:12349',
    };

    expect(tabSelectionFromConnection(connection)).toEqual<TabSelection>({
      selectedUsername: 'alice',
      selectedServerAddress: '127.0.0.1:12349',
      selectedCid: 99n,
    });
  });

  it('is null for a CID-only record, which is when the query is worth making', () => {
    // A bare ConnectSuccess writes the CID and nothing else. That is the one
    // case where asking the service is the only way to learn the rest.
    expect(tabSelectionFromConnection({ cid: 99n })).toBeNull();
  });

  it('is null when only half the pair is present', () => {
    // The negative control for the guard: checking one field and not the other
    // would produce a selection with `undefined` in it, which reads as a
    // recorded answer and is not one.
    expect(tabSelectionFromConnection({ cid: 99n, username: 'alice' })).toBeNull();
    expect(tabSelectionFromConnection({ cid: 99n, serverAddress: 'x:1' })).toBeNull();
  });

  it('is null when there is no connection at all', () => {
    expect(tabSelectionFromConnection(null)).toBeNull();
  });
});
