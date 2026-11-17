/**
 * The human check sits centred under the form it guards. Turnstile draws a
 * fixed-width iframe into the element it is given; left to itself that element
 * is a block, so the 300px widget hugged the left edge of a wider card (live,
 * 2026-10-04). The element handed to Turnstile centres what it is given.
 *
 * jsdom has no layout, so this reads the centring classes on the very element
 * Turnstile renders into; the geometry was measured in a real browser with the
 * built stylesheet when this was written. Turnstile is the fake on Cloudflare's
 * TEST site key (fake-turnstile.ts): nothing is fetched or solved.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TurnstileWidget } from '@/components/create-workspace/TurnstileWidget';
import { ALWAYS_PASS, installFakeTurnstile, type FakeTurnstile } from './fake-turnstile';

let turnstile: FakeTurnstile;
beforeEach(() => { turnstile = installFakeTurnstile(); });
afterEach(() => { delete window.turnstile; });

describe('the human check', () => {
  it('centres the widget in the element Turnstile renders into', async () => {
    render(<TurnstileWidget sitekey={ALWAYS_PASS} action="sign-in" cData="bench" onToken={() => undefined} resetSignal={0} />);
    await waitFor(() => expect(turnstile.containers).toHaveLength(1));
    const into: HTMLElement = turnstile.containers[0];
    expect(into.classList.contains('flex')).toBe(true);
    expect(into.classList.contains('justify-center')).toBe(true);
  });
});
