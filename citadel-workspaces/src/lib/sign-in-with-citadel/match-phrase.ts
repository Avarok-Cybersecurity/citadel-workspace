/**
 * The match phrase (sign-in-with-citadel.md §3): three words the client printed and the page shows,
 * both computed from the link's `challenge`, so a page that forwarded the person to another
 * attempt shows other words.
 *
 * `h = SHA3-256("citadel-sign-in-match-v1" ‖ 0x00 ‖ challenge)`; the first 33 bits of `h` are three
 * big-endian 11-bit indices into the BIP-39 English list. Mirrors `citadel-identity`'s
 * `phrase.rs`; `sign-in-kat.json` `match_phrase` is the known answer both are tested against.
 */
import { sha3_256 } from '@noble/hashes/sha3';
import { BIP39_ENGLISH } from './bip39-english';

export const MATCH_PHRASE_DOMAIN: string = 'citadel-sign-in-match-v1';
const CHALLENGE_BYTES: number = 32;
const WORD_BITS: number = 11;
const WORDS: number = 3;

/** The three match words for a 32-byte challenge. */
export function matchWords(challenge: Uint8Array): [string, string, string] {
  if (challenge.byteLength !== CHALLENGE_BYTES) throw new Error(`a challenge is ${CHALLENGE_BYTES} bytes, not ${challenge.byteLength}`);
  const domain: Uint8Array = new TextEncoder().encode(MATCH_PHRASE_DOMAIN);
  const input: Uint8Array = new Uint8Array(domain.byteLength + 1 + CHALLENGE_BYTES);
  input.set(domain, 0);
  input.set(challenge, domain.byteLength + 1);
  const h: Uint8Array = sha3_256(input);
  // The first five bytes hold the 33 bits: big-endian, so bit 0 is the top bit of h[0].
  let bits: bigint = 0n;
  for (let i: number = 0; i < 5; i++) bits = (bits << 8n) | BigInt(h[i]);
  const spare: bigint = BigInt(5 * 8 - WORDS * WORD_BITS);
  const words: string[] = [];
  for (let w: number = 0; w < WORDS; w++) {
    const shift: bigint = spare + BigInt((WORDS - 1 - w) * WORD_BITS);
    words.push(BIP39_ENGLISH[Number((bits >> shift) & 0x7ffn)]);
  }
  return [words[0], words[1], words[2]];
}
