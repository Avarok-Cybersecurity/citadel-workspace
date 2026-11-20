/** What registration hands over once, and the text Copy and Download give. Pure: no doubles. */
import { describe, expect, it } from 'vitest';
import { secretOf } from '../secret';
import { PHRASE_FILE_NAME, phraseText } from '../phrase-file';

describe('the recovery secret of a registration', () => {
  it('is the phrase when there is one, even beside codes', () => {
    expect(secretOf({ recovery_phrase: ['a', 'b'], recovery_codes: ['C-1'] })).toEqual({ kind: 'phrase', words: ['a', 'b'] });
  });
  it('is an older server\'s codes when there is no phrase', () => {
    expect(secretOf({ recovery_codes: ['C-1', 2, 'C-2'] })).toEqual({ kind: 'codes', words: ['C-1', 'C-2'] });
  });
  it('is nothing for a server without post-quantum sign-in, or a None phrase', () => {
    expect(secretOf({ recovery_codes: [] })).toBeNull();
    expect(secretOf({ recovery_codes: [], recovery_phrase: undefined })).toBeNull();
    expect(secretOf({ recovery_codes: [], recovery_phrase: [] })).toBeNull();
  });
});

describe('the phrase as text', () => {
  const words: string[] = Array.from({ length: 24 }, (_v: unknown, i: number) => `w${i + 1}`);
  it('numbers every word in order and names the account and its server', () => {
    const text: string = phraseText({ kind: 'phrase', words }, 'alice', 'bench.work.avarok.net');
    expect(text).toContain('Citadel recovery phrase for alice on bench.work.avarok.net');
    expect(text).toContain(' 1. w1\n');
    expect(text).toContain('24. w24\n');
    expect(text.indexOf('w2\n')).toBeLessThan(text.indexOf('w3\n'));
  });
  it('names the account alone when the server is unknown, and says codes are codes', () => {
    const text: string = phraseText({ kind: 'codes', words: ['C-1'] }, 'alice', null);
    expect(text).toContain('Citadel recovery codes (each signs in once) for alice\n');
  });
  it('saves under a name that says what it is', () => {
    expect(PHRASE_FILE_NAME).toBe('citadel-recovery-phrase.txt');
  });
});
