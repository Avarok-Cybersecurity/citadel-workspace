import { describe, it, expect } from 'vitest';
import { formatPresence } from '../date-utils';

/**
 * Three components each invented a different value for a fact nothing tracks.
 * UserSearch used a random offset from now, UserDirectory a literal 0 (rendered
 * as a date in 1970), and UserProfileCard `?? Date.now()` ("just now"). All three
 * stated a last-seen time to the user that was fiction.
 *
 * formatPresence exists so there is one answer, and the honest answer when the
 * value is missing is that it is not known.
 */
describe('formatPresence', () => {
  it('says online without consulting a timestamp', () => {
    expect(formatPresence(true, undefined)).toBe('Online now');
    // Even with a stale timestamp present, being online is what matters.
    expect(formatPresence(true, 1)).toBe('Online now');
  });

  it('admits when the last-seen time is unknown', () => {
    expect(formatPresence(false, undefined)).toBe('Last seen unknown');
  });

  it('treats a zero timestamp as unknown, not as 1970', () => {
    // The literal 0 UserDirectory used to pass. Rendering it as a relative time
    // produced "56 years ago", which reads as data rather than as a gap.
    expect(formatPresence(false, 0)).toBe('Last seen unknown');
  });

  it('reports a real timestamp as a relative time', () => {
    const result: string = formatPresence(false, Date.now() - 60_000);
    expect(result).toMatch(/^Last active /);
    expect(result).not.toBe('Last seen unknown');
  });
});
