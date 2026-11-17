/**
 * "Today, 11:40", "Yesterday", "Oct 9, 2026": what the Modified column says.
 */
import { describe, it, expect } from 'vitest';
import { formatModified } from '../item-format';

const NOW: number = new Date(2026, 9, 16, 15, 0).getTime();

describe('the modified time', () => {
  it('is a time of day for today', () => {
    expect(formatModified(new Date(2026, 9, 16, 11, 40).getTime(), NOW, 'en-US')).toMatch(/^Today, 11:40/);
  });

  it('is "Yesterday" for yesterday', () => {
    expect(formatModified(new Date(2026, 9, 15, 23, 59).getTime(), NOW, 'en-US')).toBe('Yesterday');
  });

  it('is a date for anything older', () => {
    expect(formatModified(new Date(2026, 9, 9, 8, 0).getTime(), NOW, 'en-US')).toBe('Oct 9, 2026');
  });

  it('is a date for a clock that is ahead, never "Today" for tomorrow', () => {
    expect(formatModified(new Date(2026, 9, 17, 9, 0).getTime(), NOW, 'en-US')).toBe('Oct 17, 2026');
  });

  it('admits it does not know when nothing was recorded', () => {
    expect(formatModified(0, NOW, 'en-US')).toBe('—');
  });
});
