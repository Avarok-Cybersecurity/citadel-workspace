/** The phrase as typed or pasted into 24 boxes, checked against the recovery word list. Pure: no doubles. */
import { describe, expect, it } from 'vitest';
import { cellError, emptyCells, enter, isRecoveryWord, PHRASE_WORDS, readCells, readingError, wordsOf, type PhraseReading } from '../phrase-entry';
import { fakePhrase } from '@/lib/sign-in/__tests__/fake-agent-recovery';

const WORDS: string[] = fakePhrase(1);

describe('entering a phrase', () => {
  it('fills all 24 boxes from the first when a whole phrase is pasted into any box', () => {
    for (const at of [0, 7, 23]) expect(enter(emptyCells(), at, WORDS.join(' '))).toEqual(WORDS);
  });

  it('takes a pasted phrase in any case, spacing, numbering or punctuation', () => {
    const messy: string = WORDS.map((w: string, i: number) => `${i + 1}. ${w.toUpperCase()},\n`).join('  ');
    expect(enter(emptyCells(), 3, messy)).toEqual(WORDS);
  });

  it('fills a line of words from the box it was pasted into, leaving the rest', () => {
    const cells: string[] = enter(emptyCells(), 5, 'abandon ability able');
    expect(cells.slice(5, 8)).toEqual(['abandon', 'ability', 'able']);
    expect(cells.filter((c: string) => c !== '')).toHaveLength(3);
  });

  it('never writes past the 24th box', () => {
    const cells: string[] = enter(emptyCells(), 22, 'abandon ability able');
    expect(cells).toHaveLength(PHRASE_WORDS);
    expect(cells.slice(22)).toEqual(['abandon', 'ability']);
  });

  it('keeps one typed word in its own box, without spaces', () => {
    expect(enter(emptyCells(), 4, ' zoo ')[4]).toBe('zoo');
  });
});

describe('checking the words', () => {
  it('knows the list, in any case', () => {
    expect(isRecoveryWord('Abandon')).toBe(true);
    expect(isRecoveryWord('citadel')).toBe(false);
  });

  it('flags a word not on the list with its position, and an empty box not at all', () => {
    expect(cellError('', 3)).toBeNull();
    expect(cellError('zoo', 3)).toBeNull();
    expect(cellError('citadelx', 4)).toBe('Word 5, "citadelx", isn\'t a recovery-phrase word. Check its spelling.');
  });

  it('reads a complete phrase, normalised, ready to send', () => {
    const cells: string[] = WORDS.map((w: string) => ` ${w.toUpperCase()} `);
    expect(readCells(cells)).toEqual({ kind: 'complete', phrase: WORDS.join(' ') });
    expect(readingError(readCells(cells))).toBeNull();
  });

  it('says which boxes are empty and which hold a stranger, wrong words first', () => {
    const cells: string[] = [...WORDS];
    cells[2] = '';
    cells[9] = 'citadelx';
    const reading: PhraseReading = readCells(cells);
    expect(reading).toEqual({ kind: 'incomplete', missing: [2], wrong: [9] });
    expect(readingError(reading)).toBe("Word 10 isn't a recovery-phrase word. Check its spelling.");
  });

  it('counts the empty boxes', () => {
    expect(readingError(readCells(emptyCells()))).toBe('24 words are still empty. The phrase is 24 words.');
    const one: string[] = [...WORDS];
    one[23] = '';
    expect(readingError(readCells(one))).toBe('Word 24 is empty.');
  });

  it('refuses a box count that is not a phrase', () => {
    expect(() => readCells(WORDS.slice(1))).toThrow(/24 boxes/);
  });

  it('splits words on anything that is not a letter', () => {
    expect(wordsOf('1.abandon\t2) ABILITY')).toEqual(['abandon', 'ability']);
  });
});
