/**
 * The UI's tier table is a copy; `billing/tiers.json` in the parent repository
 * is the original, and Stripe is made to match it. If the two drift, a visitor
 * is quoted one price and charged another -- so this reads the JSON and
 * compares every number the page shows.
 *
 * The catalogue exists only on parent revisions that carry the billing work.
 * Against one that does not, there is nothing to compare with, and this says so
 * by skipping (visibly, with the path) rather than passing. Everywhere the file
 * exists -- which includes every revision that can actually sell a plan -- it
 * is a hard check.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHAT_DOCUMENT_PACK_ADDON, LINK_PACK_ADDON, STORAGE_ADDON, TIERS, type Tier } from '../tiers';

const CATALOGUE: string = resolve(__dirname, '../../../../../billing/tiers.json');

interface CatalogueTier {
  id: string;
  limits: {
    workspaces: number; members: number; storage_gb_total?: number; storage_gb_per_seat?: number; priority_support?: boolean;
    secure_links_per_member: number; chat_documents: number;
  };
  prices: Array<{ interval: string; unit_amount: number }>;
}
interface Catalogue {
  currency: string;
  tiers: CatalogueTier[];
  addons: Array<{ id: string; available_on: string[]; grants: Record<string, number>; prices: Array<{ interval: string; unit_amount: number }> }>;
}

describe.skipIf(!existsSync(CATALOGUE))(`the tier table matches ${CATALOGUE}`, () => {
  const catalogue: Catalogue = existsSync(CATALOGUE) ? JSON.parse(readFileSync(CATALOGUE, 'utf8')) : { currency: '', tiers: [], addons: [] };

  it('is in dollars', () => {
    expect(catalogue.currency).toBe('usd');
  });

  it('offers exactly the catalogue tiers', () => {
    expect(TIERS.map((t: Tier) => t.id)).toEqual(catalogue.tiers.map((t) => t.id));
  });

  it.each(TIERS.map((t: Tier) => [t.id, t] as const))('%s: limits and prices', (_id: string, tier: Tier) => {
    const source: CatalogueTier | undefined = catalogue.tiers.find((t) => t.id === tier.id);
    expect(source, `tier ${tier.id} missing from the catalogue`).toBeDefined();
    if (!source) return;
    expect(tier.workspaces).toBe(source.limits.workspaces);
    expect(tier.maxMembers).toBe(source.limits.members);
    expect(tier.prioritySupport).toBe(source.limits.priority_support === true);
    expect(tier.secureLinksPerMember).toBe(source.limits.secure_links_per_member);
    expect(tier.chatDocuments).toBe(source.limits.chat_documents);
    if (tier.storage.kind === 'total') expect(tier.storage.gb).toBe(source.limits.storage_gb_total);
    else expect(tier.storage.gb).toBe(source.limits.storage_gb_per_seat);

    const prices: Record<string, number> = Object.fromEntries(source.prices.map((p) => [p.interval, p.unit_amount]));
    expect(tier.unitAmount).toEqual(source.prices.length === 0 ? null : prices);
  });

  it('prices the storage add-on as the catalogue does', () => {
    const addon: Catalogue['addons'][number] | undefined = catalogue.addons.find((a) => a.id === 'storage');
    expect(addon).toBeDefined();
    if (!addon) return;
    expect(STORAGE_ADDON.gbPerBlock).toBe(addon.grants.storage_gb);
    expect([...STORAGE_ADDON.availableOn]).toEqual(addon.available_on);
    expect(STORAGE_ADDON.unitAmount).toEqual(Object.fromEntries(addon.prices.map((p) => [p.interval, p.unit_amount])));
  });

  it('prices the secure-link packs as the catalogue does', () => {
    const addon: Catalogue['addons'][number] | undefined = catalogue.addons.find((a) => a.id === 'secure-links');
    expect(addon).toBeDefined();
    if (!addon) return;
    expect(LINK_PACK_ADDON.linksPerPack).toBe(addon.grants.secure_links_pool);
    expect([...LINK_PACK_ADDON.availableOn]).toEqual(addon.available_on);
    expect(LINK_PACK_ADDON.unitAmount).toEqual(Object.fromEntries(addon.prices.map((p) => [p.interval, p.unit_amount])));
  });

  it('prices the chat-document packs as the catalogue does', () => {
    const addon: Catalogue['addons'][number] | undefined = catalogue.addons.find((a) => a.id === 'chat-documents');
    expect(addon).toBeDefined();
    if (!addon) return;
    expect(CHAT_DOCUMENT_PACK_ADDON.documentsPerPack).toBe(addon.grants.chat_documents);
    expect([...CHAT_DOCUMENT_PACK_ADDON.availableOn]).toEqual(addon.available_on);
    expect(CHAT_DOCUMENT_PACK_ADDON.unitAmount).toEqual(Object.fromEntries(addon.prices.map((p) => [p.interval, p.unit_amount])));
  });

  it('mirrors every add-on the catalogue sells', () => {
    expect(catalogue.addons.map((a) => a.id)).toEqual(['storage', 'secure-links', 'chat-documents']);
  });
});
