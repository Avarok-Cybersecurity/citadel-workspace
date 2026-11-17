/**
 * A new conversation said "Offline" whenever the registry had no answer, because
 * the answer was squeezed into a boolean first. No answer is its own answer.
 */
import { describe, it, expect } from 'vitest';
import { MessagingLayerType } from '@/types/messaging-layer';
import { initialPresence } from '../initial-presence';
import { getStatusDisplay } from '@/components/p2p/P2PChatHeader';

describe('initialPresence', () => {
  it('is unknown when nothing is connected here and the registry has not said', () => {
    expect(initialPresence(false, null)).toBeNull();
  });
  it('is offline only when the registry says offline', () => {
    expect(initialPresence(false, false)?.status).toBe(MessagingLayerType.Offline);
  });
  it('is online when connected here or when the registry says so', () => {
    expect(initialPresence(true, null)?.status).toBe(MessagingLayerType.Online);
    expect(initialPresence(false, true)?.status).toBe(MessagingLayerType.Online);
  });
});

describe('the header for a peer with no presence', () => {
  it('says the status is unknown rather than offline', () => {
    expect(getStatusDisplay(null, false, true).text).toBe('Status unknown');
  });
});
