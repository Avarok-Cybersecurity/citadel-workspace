/**
 * The two pure pieces of the create-workspace form: the address a name becomes,
 * and what a plan costs.
 */
import { describe, it, expect } from 'vitest';
import { checkSlugShape, deriveSlug, sanitizeSlugInput, workspaceHostFor, type SlugShape } from '../slug';
import { availabilityFromAnswer, canContinueWith, type Availability } from '../slug-availability';
import type { UnavailableReason } from '../control-plane-client';
import {
  MAX_STORAGE_BLOCKS,
  clampSeats,
  formatUsd,
  monthsFreeOnYearly,
  quote,
  type Quote,
} from '../tiers';

describe('slug derivation', () => {
  it.each([
    ['Acme', 'acme'],
    ['Acme Robotics, Inc.', 'acme-robotics-inc'],
    ['  Café  Olé  ', 'cafe-ole'],
    ['---Team___42---', 'team-42'],
    ['Ünïcödé Straße', 'unicode-strasse'],
    ['Øresund Læring', 'oresund-laering'],
    ['日本', ''],
  ])('%s -> %s', (name: string, slug: string) => {
    expect(deriveSlug(name)).toBe(slug);
  });

  it('cuts to 32 characters without leaving a hyphen at the end', () => {
    const slug: string = deriveSlug('The Extraordinarily Long Company Name Limited');
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug.endsWith('-')).toBe(false);
    expect(checkSlugShape(slug)).toEqual({ ok: true });
  });

  it('keeps what a visitor types, lowercased, spaces as hyphens', () => {
    expect(sanitizeSlugInput('My Team')).toBe('my-team');
  });

  it('names the host', () => {
    expect(workspaceHostFor('acme')).toBe('acme.work.avarok.net');
  });
});

describe('slug shape (mirrors the control plane pattern)', () => {
  it.each<[string, SlugShape]>([
    ['acme', { ok: true }],
    ['a1b', { ok: true }],
    ['acme-robotics', { ok: true }],
    ['a'.repeat(32), { ok: true }],
    ['', { ok: false, problem: 'empty' }],
    ['ab', { ok: false, problem: 'too-short' }],
    ['a'.repeat(33), { ok: false, problem: 'too-long' }],
    ['-acme', { ok: false, problem: 'edge-hyphen' }],
    ['acme-', { ok: false, problem: 'edge-hyphen' }],
    ['Acme', { ok: false, problem: 'characters' }],
    ['ac me', { ok: false, problem: 'characters' }],
    ['acmé', { ok: false, problem: 'characters' }],
  ])('%j', (slug: string, expected: SlugShape) => {
    expect(checkSlugShape(slug)).toEqual(expected);
  });
});

describe('the quote', () => {
  it('is nothing on Free, whatever seats and storage say', () => {
    const q: Quote = quote({ tier: 'free', interval: 'month', seats: 40, storageBlocks: 9, linkPacks: 0, chatDocumentPacks: 0 });
    expect(q.totalCents).toBe(0);
    expect(q.storageGb).toBe(1);
  });

  it('charges Team per seat per month', () => {
    const q: Quote = quote({ tier: 'team', interval: 'month', seats: 7, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 0 });
    expect(q.seatsCents).toBe(7 * 600);
    expect(q.totalCents).toBe(4200);
    expect(q.storageGb).toBe(70);
  });

  it('adds storage blocks at the interval price', () => {
    const month: Quote = quote({ tier: 'business', interval: 'month', seats: 3, storageBlocks: 2, linkPacks: 0, chatDocumentPacks: 0 });
    expect(month.seatsCents).toBe(3 * 1200);
    expect(month.storageCents).toBe(2 * 200);
    expect(month.totalCents).toBe(4000);
    expect(month.storageGb).toBe(3 * 25 + 2 * 10);

    const year: Quote = quote({ tier: 'business', interval: 'year', seats: 3, storageBlocks: 2, linkPacks: 0, chatDocumentPacks: 0 });
    expect(year.totalCents).toBe(3 * 12000 + 2 * 2000);
  });

  it('never quotes a selection that cannot be bought', () => {
    expect(quote({ tier: 'team', interval: 'month', seats: 0, storageBlocks: -3, linkPacks: 0, chatDocumentPacks: 0 }).totalCents).toBe(600);
    expect(clampSeats('team', 5000)).toBe(100);
    expect(clampSeats('business', 5000)).toBe(1000);
    expect(quote({ tier: 'team', interval: 'month', seats: 1, storageBlocks: 10_000, linkPacks: 0, chatDocumentPacks: 0 }).storageCents).toBe(
      MAX_STORAGE_BLOCKS * 200,
    );
  });

  it('formats like a price list', () => {
    expect(formatUsd(600)).toBe('$6');
    expect(formatUsd(650)).toBe('$6.50');
    expect(formatUsd(120000)).toBe('$1,200');
  });

  it('says how many months yearly gives away', () => {
    expect(monthsFreeOnYearly('team')).toBe(2);
    expect(monthsFreeOnYearly('business')).toBe(2);
  });
});

describe('what an availability answer allows', () => {
  it('continues only on a yes', () => {
    expect(canContinueWith(availabilityFromAnswer('acme', { available: true }))).toBe(true);
  });

  it.each<[UnavailableReason | undefined, RegExp]>([
    ['taken', /already taken/],
    ['reserved', /reserved/],
    ['invalid', /not allowed/],
    [undefined, /not available/],
  ])('blocks on %s, and says why', (reason: UnavailableReason | undefined, message: RegExp) => {
    const answer: Availability = availabilityFromAnswer('acme', { available: false, reason });
    expect(canContinueWith(answer)).toBe(false);
    expect(answer.state === 'unavailable' ? answer.message : '').toMatch(message);
  });
});
