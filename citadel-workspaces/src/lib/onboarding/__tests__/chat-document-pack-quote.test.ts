/** What chat-document packs cost and add: Business only, 5000 documents each (owner, 2026-10-24). */
import { describe, it, expect } from 'vitest';
import { clampChatDocumentPacks, quote, type Quote } from '../tiers';

describe('chat-document packs in the quote', () => {
  it('cost $5 a month or $50 a year each on Business, and add 5000 documents per pack', () => {
    const month: Quote = quote({ tier: 'business', interval: 'month', seats: 2, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 3 });
    expect(month.chatDocumentPacksCents).toBe(3 * 500);
    expect(month.totalCents).toBe(2 * 1200 + 3 * 500);
    expect(month.chatDocuments).toBe(10_000 + 3 * 5000);
    const year: Quote = quote({ tier: 'business', interval: 'year', seats: 1, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 1 });
    expect([year.chatDocumentPacksCents, year.totalCents]).toEqual([5000, 12000 + 5000]);
  });

  it('are nothing on Free and Team, which keep their own count', () => {
    for (const [tier, own] of [['free', 50], ['team', 1000]] as const) {
      const q: Quote = quote({ tier, interval: 'month', seats: 1, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 4 });
      expect([q.chatDocumentPacksCents, q.chatDocuments]).toEqual([0, own]);
      expect(clampChatDocumentPacks(tier, 4)).toBe(0);
    }
  });
});
