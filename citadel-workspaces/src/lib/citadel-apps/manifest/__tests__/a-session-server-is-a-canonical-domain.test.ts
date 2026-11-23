/**
 * The manifest's `citadel.session` servers are read with identity-api §3's grammar: a server is
 * canonical when `canonical_domain` leaves it unchanged. Held to the contract's known answers
 * (identity-kat.json `canonical_domain`, which the Rust crate is tested against too): every
 * canonical answer is accepted, and every dialled spelling that differs from it, or is refused,
 * is not.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCanonicalServer } from '../canonical-domain';

interface Vector { dialled: string; canonical?: string; error?: string }

const KAT: string = resolve(__dirname, '../../../../../../docs/contracts/batch-1116/identity-kat.json');
const vectors: Vector[] = (JSON.parse(readFileSync(KAT, 'utf8')) as { canonical_domain: Vector[] }).canonical_domain;

describe('a canonical server name', () => {
  it('has known answers of both kinds to be held to', () => {
    expect(vectors.filter((v: Vector) => v.canonical !== undefined).length).toBeGreaterThan(3);
    expect(vectors.filter((v: Vector) => v.error !== undefined).length).toBeGreaterThan(3);
  });

  it.each(vectors.map((v: Vector): [string, Vector] => [JSON.stringify(v.dialled), v]))('%s', (_n: string, v: Vector) => {
    if (v.canonical !== undefined) expect(isCanonicalServer(v.canonical), v.canonical).toBe(true);
    expect(isCanonicalServer(v.dialled)).toBe(v.dialled === v.canonical);
  });

  it.each<[string, boolean]>([
    ['[::ffff:1.2.3.4]', true],
    ['[::ffff:102:304]', false],
    ['[::1]:443', false],
    ['a.example:65536', false],
    ['a.example/./b', false],
    ['a..example', false],
    ['x'.repeat(191), false],
  ])('%s as Ipv6Addr and the port and path rules print it', (server: string, canonical: boolean) => {
    expect(isCanonicalServer(server)).toBe(canonical);
  });
});
