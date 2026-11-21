/**
 * The recovery phrase as a person enters it: pasted whole, or typed word by word into 24 boxes.
 * Pure. Every word is checked against the recovery word list (the BIP-39 English list the agent's
 * phrase encodes with; bip39-english.ts pins it to the agent crate's copy), so a mistyped word is
 * pointed at before anything is sent. The phrase's own check digit is the agent's to verify.
 */
import { BIP39_ENGLISH } from '@/lib/sign-in-with-citadel/bip39-english';

/** How many words a recovery phrase is. */
export const PHRASE_WORDS: 24 = 24;

const WORDS: ReadonlySet<string> = new Set<string>(BIP39_ENGLISH);

/** A word as the list spells it: lowercase, no surrounding space. */
export const normalise = (word: string): string => word.trim().toLowerCase();

/** The words of a pasted or typed block, in order: any whitespace or punctuation separates them. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z]+/).filter((w: string) => w.length > 0);
}

/** Whether `word` is one of the 2048 recovery words. */
export const isRecoveryWord = (word: string): boolean => WORDS.has(normalise(word));

/** An empty box is not an error yet; a filled one that is not a recovery word is. */
export function cellError(word: string, position: number): string | null {
  const typed: string = normalise(word);
  if (typed === '' || WORDS.has(typed)) return null;
  return `Word ${position + 1}, "${typed}", isn't a recovery-phrase word. Check its spelling.`;
}

/**
 * Text typed or pasted into box `at`. One word stays in that box; several (a pasted phrase, or a
 * line of it) fill boxes from `at` onwards, and a whole 24-word phrase fills all 24 from the first.
 */
export function enter(cells: readonly string[], at: number, text: string): string[] {
  const words: string[] = wordsOf(text);
  const next: string[] = [...cells];
  if (words.length <= 1) {
    next[at] = text.replace(/\s+/g, '');
    return next;
  }
  const start: number = words.length >= PHRASE_WORDS ? 0 : at;
  words.slice(0, PHRASE_WORDS - start).forEach((word: string, i: number) => { next[start + i] = word; });
  return next;
}

/** Twenty-four empty boxes. */
export const emptyCells = (): string[] => Array.from({ length: PHRASE_WORDS }, (): string => '');

export type PhraseReading =
  | { kind: 'complete'; phrase: string }
  | { kind: 'incomplete'; missing: number[]; wrong: number[] };

/** The boxes as a phrase to send, or which boxes are empty and which hold a word not on the list. */
export function readCells(cells: readonly string[]): PhraseReading {
  if (cells.length !== PHRASE_WORDS) throw new Error(`a recovery phrase has ${PHRASE_WORDS} boxes, not ${cells.length}`);
  const missing: number[] = [];
  const wrong: number[] = [];
  cells.forEach((cell: string, i: number) => {
    const word: string = normalise(cell);
    if (word === '') missing.push(i);
    else if (!WORDS.has(word)) wrong.push(i);
  });
  if (missing.length === 0 && wrong.length === 0) return { kind: 'complete', phrase: cells.map(normalise).join(' ') };
  return { kind: 'incomplete', missing, wrong };
}

/** What to tell someone whose phrase is not ready to send: the first thing to fix. */
export function readingError(reading: PhraseReading): string | null {
  if (reading.kind === 'complete') return null;
  if (reading.wrong.length > 0) return `Word ${reading.wrong[0] + 1} isn't a recovery-phrase word. Check its spelling.`;
  const n: number = reading.missing.length;
  return n === 1 ? `Word ${reading.missing[0] + 1} is empty.` : `${n} words are still empty. The phrase is ${PHRASE_WORDS} words.`;
}
