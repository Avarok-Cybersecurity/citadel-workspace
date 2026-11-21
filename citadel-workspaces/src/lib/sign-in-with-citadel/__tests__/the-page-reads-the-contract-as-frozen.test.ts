/**
 * The page's link parser and shape guards against the frozen contract's own fixtures and known
 * answers (docs/contracts/batch-1116): every `valid*` fixture accepted, every `invalid-*` refused,
 * the match phrase of `sign-in-kat.json`, and the word list byte-identical to BIP-39's and to the
 * agent crate's copy. Negative controls: dropping `exactKeys` from a guard turns the
 * `invalid-unknown-field` fixtures green-as-accepted and fails here; changing one word fails the
 * sha256.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromBase64Url } from '@/lib/passkey/bytes';
import { parseSignInLink } from '../link';
import { isBeginResponse, isProveResponse, isReturnAllowlist } from '../issuer-wire';
import { matchWords } from '../match-phrase';
import { BIP39_ENGLISH } from '../bip39-english';

/** vitest runs from citadel-workspaces/; the contracts and the agent tree are beside it. */
const REPO: string = resolve(process.cwd(), '..');
const CONTRACTS: string = join(REPO, 'docs/contracts/batch-1116');
const FIXTURES: string = join(CONTRACTS, 'fixtures/sign-in-with-citadel');
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function fixtures(kind: string): { name: string; valid: boolean; value: unknown }[] {
  const names: string[] = readdirSync(join(FIXTURES, kind)).filter((n: string) => n.endsWith('.json'));
  expect(names.length).toBeGreaterThan(1);
  return names.map((name: string) => ({ name, valid: name.startsWith('valid'), value: readJson(join(FIXTURES, kind, name)) }));
}

describe('every SignInLink fixture', () => {
  it.each(fixtures('SignInLink'))('$name', ({ valid, value }) => {
    const query: string = `?${new URLSearchParams(value as Record<string, string>).toString()}`;
    const parsed: ReturnType<typeof parseSignInLink> = parseSignInLink(query);
    expect(parsed.ok).toBe(valid);
    if (parsed.ok) expect(parsed.value).toEqual(value);
  });

  it('refuses a parameter given twice', () => {
    expect(parseSignInLink('?client=sw-mcp&client=sw-mcp&challenge=2i7js9uw64RvSzVINywDxXLTQyLI6lZfTFFFUHnJsDc&state=ozHjXJPho4EgyGbICkCj-g&return=https%3A%2F%2Fwork.avarok.net%2Fsign-in%2Fcode').ok).toBe(false);
  });
});

describe.each([
  ['ReturnAllowlist', isReturnAllowlist],
  ['SignInBeginResponse', isBeginResponse],
  ['SignInProveResponse', isProveResponse],
] as const)('every %s fixture', (kind, guard) => {
  it.each(fixtures(kind))('$name', ({ valid, value }) => {
    expect(guard(value)).toBe(valid);
  });
});

describe('the match phrase', () => {
  it('reproduces sign-in-kat.json for its challenge', () => {
    const kat: { challenge_b64url: string; match_phrase: { words: string[] } } = readJson(join(CONTRACTS, 'sign-in-kat.json')) as never;
    const challenge: Uint8Array | null = fromBase64Url(kat.challenge_b64url);
    expect(challenge).not.toBeNull();
    expect(matchWords(challenge as Uint8Array)).toEqual(kat.match_phrase.words);
  });

  it('refuses a challenge that is not 32 bytes', () => {
    expect(() => matchWords(new Uint8Array(31))).toThrow();
  });
});

describe('the word list', () => {
  it("is BIP-39's English list (the contract's sha256)", () => {
    const digest: string = createHash('sha256').update(`${BIP39_ENGLISH.join('\n')}\n`).digest('hex');
    expect(digest).toBe('2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  });

  it("is the agent crate's list, word for word", () => {
    const rust: string = readFileSync(join(REPO, 'citadel-internal-service/citadel-identity/src/wordlist.rs'), 'utf8');
    const words: string[] = [...rust.split('= [')[1].matchAll(/"([a-z]+)"/g)].map((m: RegExpMatchArray) => m[1]);
    expect(words).toEqual([...BIP39_ENGLISH]);
  });
});
