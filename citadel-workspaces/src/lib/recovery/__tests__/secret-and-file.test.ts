/** What registration hands over once, and the text Copy and Download give. Pure: no doubles. */
import { describe, expect, it } from 'vitest';
import { phraseOf } from '../secret';
import { PHRASE_FILE_NAME, phraseText } from '../phrase-file';

describe('the recovery phrase of a registration', () => {
  it('is its words, in order, and nothing that is not a word', () => {
    expect(phraseOf({ recovery_phrase: ['a', 2, 'b'] })).toEqual(['a', 'b']);
  });
  it('is nothing when the answer carries no phrase', () => {
    expect(phraseOf({})).toBeNull();
    expect(phraseOf({ recovery_phrase: undefined })).toBeNull();
    expect(phraseOf({ recovery_phrase: [] })).toBeNull();
  });
});

describe('the phrase as text', () => {
  const words: string[] = Array.from({ length: 24 }, (_v: unknown, i: number) => `w${i + 1}`);
  it('numbers every word in order and names the account and its server', () => {
    const text: string = phraseText(words, 'alice', 'bench.work.avarok.net');
    expect(text).toContain('Citadel recovery phrase for alice on bench.work.avarok.net');
    expect(text).toContain(' 1. w1\n');
    expect(text).toContain('24. w24\n');
    expect(text.indexOf('w2\n')).toBeLessThan(text.indexOf('w3\n'));
  });
  it('names the account alone when the server is unknown', () => {
    expect(phraseText(['w1'], 'alice', null)).toContain('Citadel recovery phrase for alice\n');
  });
  it('saves under a name that says what it is', () => {
    expect(PHRASE_FILE_NAME).toBe('citadel-recovery-phrase.txt');
  });
});
