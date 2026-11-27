/** version.json carries the build's recorded UX score, read from the committed baseline. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordedUxScore } from '../version-manifest';

describe('recordedUxScore', () => {
  it('reads the committed baseline', () => {
    const text: string = readFileSync(resolve(__dirname, '../../../../scripts/ux-score.baseline.json'), 'utf8');
    expect(recordedUxScore(text)).toBe(JSON.parse(text).score);
  });
  it.each(['{}', '{"score":"4"}', '{"score":101}', '{"score":-1}'])('refuses %s rather than ship no score', (text: string) => {
    expect(() => recordedUxScore(text)).toThrow(/no score/);
  });
});
