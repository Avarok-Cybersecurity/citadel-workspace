/**
 * The DM header's presence, and the branch that made the rest unreachable.
 *
 * `registered` short-circuited ahead of every presence state — and it is true
 * for every peer you can have a conversation with, by construction, since the
 * conversation exists because the registration does. So Away, Offline and the
 * user's own custom status were sent by the peer, received, routed and stored,
 * and displayed nowhere. The header showed "Registered", which is protocol
 * vocabulary rather than a state a person is in.
 */

import { describe, it, expect } from 'vitest';
import { getStatusDisplay } from '../P2PChatHeader';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { PeerPresence } from '@/lib/p2p/p2p-types';

const presence: (status: MessagingLayerType, extra?: {}) => NonNullable<Parameters<typeof getStatusDisplay>[0]> = (status: MessagingLayerType, extra = {}) =>
  ({ status, lastUpdate: 0, ...extra }) as NonNullable<Parameters<typeof getStatusDisplay>[0]>;

describe('the DM header status', () => {
  it('shows Away for a registered peer who is away', () => {
    // Registered is true here, as it is for every conversation peer. That must
    // not hide what the peer actually told us.
    const status: ReturnType<typeof getStatusDisplay> = getStatusDisplay(presence(MessagingLayerType.Away), false, true);
    expect(status.text).toBe('Away');
  });

  it('shows a peer custom status text rather than the word Registered', () => {
    const status: ReturnType<typeof getStatusDisplay> = getStatusDisplay(
      presence(MessagingLayerType.CustomState, { customText: 'In a meeting' }),
      false,
      true,
    );
    expect(status.text).toBe('In a meeting');
  });

  it('never shows protocol vocabulary as a presence state', () => {
    for (const state of [
      MessagingLayerType.Online,
      MessagingLayerType.Away,
      MessagingLayerType.Offline,
      MessagingLayerType.CustomState,
    ]) {
      for (const registered of [true, false]) {
        const { text } = getStatusDisplay(presence(state), false, registered);
        expect(text, `${state}/${registered}`).not.toBe('Registered');
      }
    }
  });

  it('still puts a live connection ahead of a stale presence value', () => {
    const status: ReturnType<typeof getStatusDisplay> = getStatusDisplay(presence(MessagingLayerType.Offline), true, true);
    expect(status.text).toBe('Online');
  });

  it('distinguishes a registered peer with no presence from an unregistered one', () => {
    const unknown: PeerPresence = presence('nonsense' as unknown as MessagingLayerType);
    expect(getStatusDisplay(unknown, false, true).text).toBe('Offline');
    expect(getStatusDisplay(unknown, false, false).text).toBe('Not connected');
  });
});
