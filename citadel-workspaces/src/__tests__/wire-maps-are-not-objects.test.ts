/**
 * A Rust `HashMap` arrives as a JS `Map`, whatever the generated type says.
 *
 * serde-wasm-bindgen is configured without `serialize_maps_as_objects`, so a
 * Rust `HashMap` crosses as a real `Map`. ts-rs declares the same field
 * `Record<string, T>`. Both are "correct"; together they mean `Object.keys` and
 * `Object.entries` return nothing, silently, and the compiler agrees with you.
 *
 * That cost `peer_connections` twice. The fix was found once and applied in
 * `p2p-registration-service/connection.ts`, whose comment spells it out — and
 * two sites in `p2p-auto-connect-service` kept the object form, so
 * `refreshFromBackend` merged nothing and auto-connect always took the "no
 * peer_connections in session" fallback. The server's view of who a session is
 * connected to was unreachable from either path.
 *
 * Then it cost `map` as well, and this test did not see it, for two reasons
 * that are both worth fixing rather than patching around:
 *
 *   1. `WIRE_MAPS` was a hand-maintained list of ONE field. Six fields cross as
 *      Rust `HashMap`s. A list is only as complete as its last edit — the same
 *      shape as the denylist that let `formatForDebug` through. It is now
 *      DERIVED from the Rust source when that source is reachable, and the
 *      hardcoded set is a floor that cannot silently shrink.
 *
 *   2. The offending read was ALIASED. `server-utils.ts` did
 *      `const kvMap = getAllKVSuccess.map` and then `Object.keys(kvMap)`, so a
 *      pattern matching the field name next to `Object.keys` could never fire.
 *      One level of aliasing is now resolved.
 *
 * What that cost: `listKnownServers` always returned zero servers, so the list
 * of previously-connected workspaces was permanently empty and every user
 * retyped the address, while `known_servers` was being written correctly the
 * whole time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/**
 * Fields that cross the wire as a Rust `HashMap`.
 *
 * A floor, not the list. The real list is derived from the Rust types below
 * when they are reachable; these are the ones known to cross that way, and the
 * derivation may only ever ADD to them.
 */
const KNOWN_WIRE_MAPS: string[] = [
  'peer_connections',
  'map',
  'peer_information',
  'peers',
  'accounts',
];

/** Where the wire types live, from this repo, when checked out inside the parent. */
const WIRE_TYPES: string = join(
  process.cwd(),
  '..',
  'citadel-internal-service',
  'citadel-internal-service-types',
  'src',
  'lib.rs',
);

/** Every `pub <name>: HashMap<…>` in the wire types. */
function declaredWireMaps(): string[] | null {
  if (!existsSync(WIRE_TYPES)) return null;
  const rust: string = readFileSync(WIRE_TYPES, 'utf-8');
  const names: Set<string> = new Set<string>();
  for (const m of rust.matchAll(/pub\s+([a-z_]+)\s*:\s*(?:Option<)?HashMap</g)) names.add(m[1]);
  return [...names];
}

/**
 * Reading one as a plain object, which yields nothing at runtime.
 *
 * The field must be reached through a PROPERTY ACCESS — `x.map`, not a bare
 * identifier that happens to be spelled `map`. Without that, `formatBytesMap`'s
 * own parameter, which has nothing to do with the wire, was reported: two of the
 * gate's first three findings were invented, which is the ratio that gets a
 * gate switched off.
 */
const AS_OBJECT = (field: string): RegExp =>
  new RegExp(String.raw`Object\.(?:keys|entries|values)\s*\(\s*[\w.[\]]*\.\s*${field}\b`);

/** An aliased read: the alias IS the value, so a bare identifier is right here. */
const ALIAS_AS_OBJECT = (name: string): RegExp =>
  new RegExp(String.raw`Object\.(?:keys|entries|values)\s*\(\s*${name}\s*\)`);

/**
 * Does this file handle the Map form at all?
 *
 * `p2p-registration-service/discovery.ts` branches: it takes the `Map` path
 * first and falls back to `Object.entries` only in the `else if`. That is
 * correct code, and flagging it would be flagging the fix. A file that
 * demonstrably knows about the Map form is not blind to it.
 */
const HANDLES_MAP: RegExp = /instanceof\s+Map\b|as\s+Map<|wireMapEntries\s*\(/;

/**
 * Local names bound to a wire-map field, so an aliased read is still a read.
 *
 * `const kvMap = getAllKVSuccess.map` followed by `Object.keys(kvMap)` is the
 * exact shape that defeated the first version of this test.
 */
function aliasesOf(source: string, field: string): string[] {
  const names: string[] = [];
  const re: RegExp = new RegExp(
    String.raw`\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*[^;\n]*\.\s*${field}\b`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) names.push(m[1]);
  return names;
}

describe('a field that is a Rust HashMap', () => {
  it('is read with wireMapEntries, not Object.keys', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    });

    const declared: string[] | null = declaredWireMaps();
    if (declared !== null) {
      // The floor may only grow. A field that stopped being a HashMap upstream
      // is fine to drop; one that quietly vanished from the derivation is not.
      const missing: string[] = KNOWN_WIRE_MAPS.filter((f) => !declared.includes(f));
      expect(
        missing,
        'these fields are known to cross as Rust HashMaps but the derivation did not find ' +
          'them — the wire types moved, and this test is now reading a smaller world than it ' +
          'thinks',
      ).toEqual([]);
    }
    const wireMaps: string[] = [...new Set([...KNOWN_WIRE_MAPS, ...(declared ?? [])])];

    const offenders: string[] = [];

    for (const rel of files) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      if (HANDLES_MAP.test(source)) continue;
      for (const field of wireMaps) {
        if (AS_OBJECT(field).test(source)) offenders.push(`${rel}: reads ${field} as an object`);
        for (const alias of aliasesOf(source, field)) {
          if (ALIAS_AS_OBJECT(alias).test(source)) {
            offenders.push(`${rel}: reads ${field} as an object, via \`${alias}\``);
          }
        }
      }
    }

    expect(
      offenders,
      'serde-wasm-bindgen delivers a Rust HashMap as a JS Map, so Object.keys ' +
        'and Object.entries return nothing here — silently, and with the ' +
        'generated Record<> type agreeing. Use wireMapEntries from lib/wire-map.',
    ).toEqual([]);
  });

  it('has a helper that actually handles both shapes', async () => {
    // The rule above is only worth having if the alternative works. A helper
    // that only handled Map would be as wrong as Object.entries, in the other
    // direction — an older wire, or a test fixture, hands over a plain object.
    const { wireMapEntries } = await import('@/lib/wire-map');

    expect(wireMapEntries(new Map([['1', 'a']]), 'x')).toEqual([['1', 'a']]);
    expect(wireMapEntries({ 1: 'a' }, 'x')).toEqual([['1', 'a']]);
    expect(wireMapEntries(undefined, 'x')).toEqual([]);
    expect(wireMapEntries(null, 'x')).toEqual([]);
  });
});
