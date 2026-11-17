/**
 * Every module that reads LocalDB and catches must tell absent from failed.
 *
 * `sendLocalDBGet` rejects for BOTH "no such key" and "the socket is down". A
 * catch that treats them alike returns the same answer for "nothing is stored"
 * and "I could not find out" — and upstream, those answers mean very different
 * things:
 *
 *  - no stored sessions → the reconnect machinery sends the user to the landing
 *    page. A failed read does that to somebody with a live session.
 *  - no such document → reported as "this document does not exist".
 *  - default preference → silently turns auto-connect back on for somebody who
 *    turned it off.
 *
 * Round 265 unified the PREDICATE and added a test refusing a fifth copy of the
 * string. That guard could not see this: `connection/session-management` never
 * tested the string at all — it caught everything into one line — so nothing
 * flagged it, and CI printed
 *
 *   [ConnectionService] Failed to load stored sessions Error: Key not found
 *
 * on every boot for weeks. A guard against copies of a fix is not a guard
 * against the absence of one.
 *
 * The allow-list is the point: a module lands on it by somebody deciding it
 * belongs there and writing down why, not by nobody noticing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';

const SRC: string = join(process.cwd(), 'src');

/**
 * Reads LocalDB, catches, and does not classify — with the reason why.
 *
 * `peer-registration-store/persistence.ts` was on this list with the reason
 * "its catches wrap sendMessage rejections on the WRITE path, where absence is
 * not a state". That was simply false: the catch and the reject callback it
 * named are both on the READ path, and both resolved as though the key held
 * nothing. Two pending contact requests could be erased by one timeout. An
 * exemption is a claim about the code, and this one was never true.
 *
 * Known limit, stated here rather than discovered later: `classifies` below is
 * a whole-FILE test. A module where one function classifies and another does
 * not passes. `live-document-store/persistence.ts` is exactly that shape today.
 */
const EXEMPT: Record<string, string> = {
  'lib/live-document-store/service.ts':
    'its catch does not decide absence — it records that the index is untrustworthy, ' +
    'so the write is refused; the classification is in persistence.loadIndexFromDB',
  // The reads moved to local-db-client.ts when this file passed the 250-line
  // cap; that module classifies. What is left here is `resolveKVResponse`,
  // whose catch wraps parsePersistedJSON on bytes already returned — a decode
  // failure, not an absent key. Same reason as io-websocket.ts below.
  'lib/peer-registration-store/persistence.ts':
    'its remaining catch is around JSON decoding of a value already read; the reads live in local-db-client.ts',
  'lib/connection/io-websocket.ts':
    'its one catch is around JSON decoding of a value already read, not the read',
  'lib/peer-registration-store/service.ts':
    'catches around accept/decline requests, not around a read',
};

/**
 * Source with comments removed.
 *
 * `classifies` below is a substring test, so a file that merely NAMES
 * `isGenuinelyAbsent` in a comment counted as classifying. `io-websocket.ts`
 * tripped exactly that: a comment explaining that its CALLER does the
 * classification made the file look like it classified, and its exemption was
 * reported as stale.
 *
 * This repository has found the same shape before, in a gate that matched the
 * example string quoted in its own header. A check a comment can satisfy is a
 * check prose can pass.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function readsLocalDb(source: string): boolean {
  // `FromDB(` as well as `FromLocalDB(`. `live-document-store` names its
  // readers `loadIndexFromDB` / `loadDocumentFromDB`, which matched none of
  // the original three patterns -- so the module holding the index read, the
  // one whose result decides what the index is OVERWRITTEN with, was outside
  // this rule entirely.
  // `LocalDBGetKV` — the request literal — as well as the helper names.
  //
  // Splitting peer-registration-store's client into its own module put the
  // reads in a file this rule could not see: the helper is DEFINED there as
  // `localDBGet<T>(`, and `localDBGet\(` needs the paren directly after the
  // name. The module issuing the raw request is exactly the module that must
  // classify, so match on the request it builds rather than on the name a
  // caller happens to use.
  // `LocalDBGetKV: {` — the request being BUILT, not a response variant.
  //
  // A bare `LocalDBGetKV` also matches `LocalDBGetKVSuccess` and
  // `LocalDBGetKVFailure`, which is what event-handlers.ts reads: it handles
  // answers, it does not issue reads, and it has no absence decision to make.
  // The colon-brace is what distinguishes constructing the request from
  // recognising its reply.
  return /sendLocalDBGet|localDBGet\s*[<(]|FromLocalDB\(|FromDB\(|LocalDBGetKV\s*:\s*\{/.test(source);
}

describe('a module that reads LocalDB', () => {
  it('tells an absent key from a failed read, or says why it need not', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    });

    const offenders: string[] = [];
    const staleExemptions: string[] = [];

    for (const rel of files) {
      const source: string = readFileSync(join(SRC, rel), 'utf-8');
      const code: string = withoutComments(source);
      if (!readsLocalDb(code)) continue;
      if (!/catch\s*\(/.test(code)) continue;

      // A CALL, not a mention. `includes('isGenuinelyAbsent')` was satisfied by
      // the import line alone, so a file could import the classifier, never
      // call it, and pass. Verified: stubbing out every real call in
      // live-document-store/persistence.ts while leaving the import left this
      // test green.
      const classifies: boolean = /isGenuinelyAbsent\s*\(/.test(
        code.replace(/^\s*import[^;]*;/gm, ''),
      );
      if (classifies && rel in EXEMPT) staleExemptions.push(rel);
      if (!classifies && !(rel in EXEMPT)) offenders.push(rel);
    }

    expect(
      offenders,
      'import isGenuinelyAbsent from lib/storage/absence and say which case you ' +
        'are in, or add the module to EXEMPT with the reason it does not need to.',
    ).toEqual([]);

    expect(
      staleExemptions,
      'these classify now, so their exemption is stale — remove it, or the list ' +
        'stops meaning anything.',
    ).toEqual([]);
  });
});
