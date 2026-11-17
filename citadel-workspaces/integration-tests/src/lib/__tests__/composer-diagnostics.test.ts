import { describe, it, expect } from 'vitest';
import {
  RUN_DIAGNOSTIC_KEYWORDS,
  COMPOSER_WITHHELD_SAMPLE,
  keywordsMatch,
} from '../composer-diagnostics.js';

describe('the composer diagnostic filter', () => {
  it('keeps the line that says why the composer was removed', () => {
    expect(keywordsMatch(COMPOSER_WITHHELD_SAMPLE, RUN_DIAGNOSTIC_KEYWORDS)).toBe(true);
  });

  it('keeps the line that says a group was created', () => {
    // `peer-group` fails on "group creation produced no group id", and the
    // capture kept 2,271 lines with nothing about a group in them.
    expect(keywordsMatch('[GroupStore] Group created: {groupId: 7:42}', RUN_DIAGNOSTIC_KEYWORDS)).toBe(true);
  });

  it('still filters something out, so it is a filter and not a passthrough', () => {
    // A list that matches everything would pass the first test for the wrong
    // reason.
    expect(keywordsMatch('[Router] routeMessage: type=GetSessionsResponse', RUN_DIAGNOSTIC_KEYWORDS)).toBe(false);
  });
});
