/** A call cut off mid-call by a tab takeover did start; its heading says so. */
import { describe, it, expect } from 'vitest';
import { failedCallTitle } from '../call-failure-detail';
import { LOST_ON_TAKEOVER } from '../lost-on-takeover';

describe('the heading over a failed call', () => {
  it('says the call was cut off when it lost its connection to a takeover', () => {
    expect(failedCallTitle(LOST_ON_TAKEOVER)).toBe('The call was cut off');
  });
  it('says the call could not start otherwise', () => {
    expect(failedCallTitle('no UDP channel for peer 2')).toBe('The call could not start');
    expect(failedCallTitle(null)).toBe('The call could not start');
  });
});
