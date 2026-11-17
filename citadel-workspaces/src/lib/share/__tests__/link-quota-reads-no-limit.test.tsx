/**
 * The server sends `null` for a link limit an unlimited plan does not have
 * (`SecureLinksResponse::Links.per_member` / `pool`). The page reads it as no limit: always room,
 * the count with "no limit", and no bar to fill. A finite plan reads as it did.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { atLimit, quotaFraction, quotaText, type LinkQuota } from '../link-lifetime';
import { QuotaMeter } from '@/components/share/QuotaMeter';

const UNLIMITED: LinkQuota = { live: 12, perMember: null, pool: null, poolUsed: 0 };
const FULL: LinkQuota = { live: 5, perMember: 5, pool: 50, poolUsed: 50 };

describe('no limit', () => {
  it('is always room, counts what is live, and has nothing to measure against', () => {
    expect(atLimit(UNLIMITED)).toBe(false);
    expect(atLimit({ ...UNLIMITED, live: 1_000_000 })).toBe(false);
    expect(quotaText(UNLIMITED)).toBe('12 secure links, no limit');
    expect(quotaText({ ...UNLIMITED, live: 1 })).toBe('1 secure link, no limit');
    expect(quotaFraction(UNLIMITED)).toBeNull();
  });

  it('on the pool alone still leaves room past your own allowance', () => {
    const pool: LinkQuota = { live: 9, perMember: 5, pool: null, poolUsed: 4 };
    expect(atLimit(pool)).toBe(false);
    expect(quotaText(pool)).toBe('5 of 5 yours · 4 from the shared pool, no limit');
    expect(quotaFraction(pool)).toBeNull();
  });

  it('draws the count and no meter', () => {
    render(<QuotaMeter quota={UNLIMITED} testId="q" />);
    expect(screen.getByTestId('q-text')).toHaveTextContent('12 secure links, no limit');
    expect(screen.queryByRole('meter')).toBeNull();
  });
});

describe('a finite plan, as before', () => {
  it('reads its counts and fills its bar', () => {
    expect(atLimit(FULL)).toBe(true);
    expect(quotaText(FULL)).toBe('5 of 5 yours · 50 of 50 shared pool');
    expect(quotaFraction(FULL)).toBe(1);
    expect(quotaText({ live: 3, perMember: 5, pool: 0, poolUsed: 0 })).toBe('3 of 5 yours');
    render(<QuotaMeter quota={FULL} testId="q" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
  });
});
