import { describe, it, expect } from 'vitest';
import { childTypeChoice } from '../child-type-choice';

describe('childTypeChoice', () => {
  it('has nothing to add when no type is allowed', () => {
    expect(childTypeChoice([])).toEqual({ kind: 'none' });
    expect(childTypeChoice(null)).toEqual({ kind: 'none' });
    expect(childTypeChoice(undefined)).toEqual({ kind: 'none' });
  });
  it('uses the only type without asking', () => {
    expect(childTypeChoice(['Room'])).toEqual({ kind: 'one', type: 'Room' });
  });
  it('asks when the schema allows several, in the schema order', () => {
    expect(childTypeChoice(['Room', 'Office'])).toEqual({ kind: 'pick', types: ['Room', 'Office'] });
  });
});
