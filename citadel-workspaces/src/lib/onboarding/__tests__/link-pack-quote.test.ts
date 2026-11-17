/** What secure-link packs cost and add, on the tiers that sell them. */
import { describe, it, expect } from 'vitest';
import { LINK_PACK_ADDON, MAX_LINK_PACKS, clampLinkPacks, quote, tierById, type Quote } from '../tiers';

describe('link packs in the quote', () => {
  it('cost $2 a month or $20 a year each, and add 50 shared links per pack', () => {
    const month: Quote = quote({ tier: 'team', interval: 'month', seats: 3, storageBlocks: 1, linkPacks: 2, chatDocumentPacks: 0 });
    expect(month.linkPacksCents).toBe(2 * 200);
    expect(month.totalCents).toBe(3 * 600 + 200 + 2 * 200);
    expect(month.sharedLinks).toBe(100);
    const year: Quote = quote({ tier: 'business', interval: 'year', seats: 1, storageBlocks: 0, linkPacks: 3, chatDocumentPacks: 0 });
    expect(year.linkPacksCents).toBe(3 * 2000);
    expect(year.totalCents).toBe(12000 + 6000);
  });

  it('are nothing on Free, which sells none', () => {
    const q: Quote = quote({ tier: 'free', interval: 'month', seats: 3, storageBlocks: 0, linkPacks: 5, chatDocumentPacks: 0 });
    expect([q.linkPacksCents, q.sharedLinks, q.totalCents]).toEqual([0, 0, 0]);
    expect(LINK_PACK_ADDON.availableOn).not.toContain('free');
  });

  it('are clamped to whole packs a stepper can offer', () => {
    expect(clampLinkPacks('team', -2)).toBe(0);
    expect(clampLinkPacks('team', 2.4)).toBe(2);
    expect(clampLinkPacks('business', 10_000)).toBe(MAX_LINK_PACKS);
    expect(clampLinkPacks('free', 3)).toBe(0);
  });

  it('leave each member the tier allowance: 5 on Free, 50 on paid tiers', () => {
    expect(['free', 'team', 'business'].map((t) => tierById(t as 'free' | 'team' | 'business').secureLinksPerMember)).toEqual([5, 50, 50]);
  });
});
