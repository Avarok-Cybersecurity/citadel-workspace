/**
 * The marketplace reads a manifest with the kernel's rules: every case in the shared fixture
 * (apps/catalogue/fixtures/manifest-cases.json, the Rust tests' base manifest with one change
 * each) is accepted or refused exactly as `AppManifest::from_bytes` answers it, for the same
 * field. The base manifest is accepted, so each refusal is its one change.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readManifestBytes, MAX_MANIFEST_BYTES, type ManifestReading } from '../manifest-rules';
import { hasDuplicateKeys } from '../json-duplicate-keys';
import { manifestCaseBytes, type ManifestCases, type ManifestCase } from './manifest-cases';

const CASES: string = resolve(__dirname, '../../../../../../apps/catalogue/fixtures/manifest-cases.json');
const fixture: ManifestCases = JSON.parse(readFileSync(CASES, 'utf8')) as ManifestCases;
const verdict = (r: ManifestReading): string => (r.ok ? 'ok' : r.field);

describe('a manifest, read by the shared cases', () => {
  it('has the base manifest and refusals of every field', () => {
    const fields: Set<string> = new Set(fixture.cases.map((c: ManifestCase) => c.expect));
    for (const f of ['ok', 'Json', 'Format', 'Id', 'Version', 'Sdk', 'Publisher', 'Name', 'Summary', 'Description', 'Icon', 'Categories', 'Audience', 'Surfaces', 'Scopes', 'Capabilities', 'Limits', 'Artifact', 'PreviousVersions']) {
      expect(fields.has(f), f).toBe(true);
    }
  });

  it.each(fixture.cases.map((c: ManifestCase): [string, ManifestCase] => [c.name, c]))('%s', (_n: string, c: ManifestCase) => {
    expect(verdict(readManifestBytes(manifestCaseBytes(fixture.base, c)))).toBe(c.expect);
  });

  it('a manifest over the size cap is refused before it is read', () => {
    const big: Uint8Array = new Uint8Array(MAX_MANIFEST_BYTES + 1).fill(0x20);
    expect(verdict(readManifestBytes(big))).toBe('TooLarge');
  });

  it('the accepted manifest comes back typed: the icon cap a bigint', () => {
    const r: ManifestReading = readManifestBytes(manifestCaseBytes(fixture.base, fixture.cases[0]));
    expect(r.ok && r.manifest.icon.max_bytes).toBe(65536n);
  });
});

describe('duplicate keys, which JSON.parse forgives', () => {
  it('finds a key named twice at any depth, and not keys that only look alike', () => {
    expect(hasDuplicateKeys('{"a":1,"a":2}')).toBe(true);
    expect(hasDuplicateKeys('{"a":{"b":1,"b":1}}')).toBe(true);
    expect(hasDuplicateKeys('{"a":[{"b":1},{"b":1}],"c":"\\"a\\""}')).toBe(false);
    expect(hasDuplicateKeys('{"a":"a","b":{"a":1}}')).toBe(false);
    expect(hasDuplicateKeys('{"\\u0061":1,"a":2}')).toBe(true);
  });
});
