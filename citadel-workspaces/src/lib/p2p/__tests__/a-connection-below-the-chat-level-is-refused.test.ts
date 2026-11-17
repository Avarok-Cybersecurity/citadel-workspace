/**
 * Which offered connections a chat's minimum level admits.
 *
 * The level a P2P channel is keyed at is the one the side that opens it asked
 * for: the agent ignores the acceptor's settings and the SDK builds both ends
 * of the ratchet from the opener's Stage0. So "this chat is High" can only be
 * kept by refusing an offer below High and opening the channel ourselves.
 */
import { describe, it, expect } from 'vitest';
import { offerMeetsMinimum, higherLevel } from '../security-level-rank';

describe('offerMeetsMinimum', () => {
  it.each([
    ['Standard', 'Standard', true],
    ['Reinforced', 'High', false],
    ['High', 'High', true],
    ['Ultra', 'High', true],
    ['Extreme', 'High', true],
    ['Standard', 'Extreme', false],
  ] as const)('an offer at %s against a minimum of %s -> %s', (offered: string, minimum: 'Standard' | 'Reinforced' | 'High' | 'Extreme', admitted: boolean) => {
    expect(offerMeetsMinimum(offered, minimum)).toBe(admitted);
  });

  it('reads a custom level by its value', () => {
    expect(offerMeetsMinimum({ Custom: 2 }, 'High')).toBe(true);
    expect(offerMeetsMinimum({ Custom: 1 }, 'High')).toBe(false);
  });

  it('refuses an unreadable level unless nothing above the default was asked for', () => {
    expect(offerMeetsMinimum(undefined, 'Reinforced')).toBe(false);
    expect(offerMeetsMinimum('Bogus', 'High')).toBe(false);
    // Positive control: with the default minimum every offer is admitted, which
    // is exactly how this browser behaved before the setting existed.
    expect(offerMeetsMinimum(undefined, 'Standard')).toBe(true);
  });
});

describe('higherLevel', () => {
  it('is the stronger of two levels, either way round', () => {
    expect(higherLevel('Reinforced', 'High')).toBe('High');
    expect(higherLevel('Extreme', 'Standard')).toBe('Extreme');
  });
});
