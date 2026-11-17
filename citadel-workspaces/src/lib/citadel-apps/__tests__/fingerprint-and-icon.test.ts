/**
 * The two things on a listing that come from bytes: the publisher key's fingerprint, held to the
 * fixture the Rust crate is also tested against, and the icon, drawn only when it is a PNG within
 * its cap.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publisherFingerprint } from '../fingerprint';
import { appIconSrc } from '../icon';

interface FingerprintCase { name: string; public_key: string; fingerprint: string | null }
const FIXTURE: string = resolve(__dirname, '../../../../../apps/catalogue/fixtures/app-fingerprint-fixtures.json');
const cases: FingerprintCase[] = JSON.parse(readFileSync(FIXTURE, 'utf8')) as FingerprintCase[];

describe('a publisher key fingerprint', () => {
  it('the fixture has keys and refusals', () => {
    expect(cases.filter((c: FingerprintCase) => c.fingerprint !== null).length).toBeGreaterThanOrEqual(2);
    expect(cases.filter((c: FingerprintCase) => c.fingerprint === null).length).toBeGreaterThanOrEqual(2);
  });

  it.each(cases.map((c: FingerprintCase): [string, FingerprintCase] => [c.name, c]))('%s', async (_n: string, c: FingerprintCase) => {
    expect(await publisherFingerprint(c.public_key)).toBe(c.fingerprint);
  });

  it('two different keys never share a fingerprint in the fixture', () => {
    const shown: Set<string | null> = new Set(cases.slice(0, 2).map((c: FingerprintCase) => c.fingerprint));
    expect(shown.size).toBe(2);
  });
});

// 14 bytes, so the base64 is padded and holds a '+': both refusals below then change something.
const PNG: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0xfb, 0xef];
const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));

describe('an app icon', () => {
  it('draws a PNG within its cap as a data URL of the same bytes', () => {
    expect(appIconSrc({ png_base64: b64(PNG), max_bytes: 64n })).toBe(`data:image/png;base64,${b64(PNG)}`);
  });

  it.each([
    ['bad magic bytes', { png_base64: b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]), max_bytes: 64n }],
    ['an SVG', { png_base64: btoa('<svg onload="x()"></svg>'), max_bytes: 64n }],
    ['more bytes than declared', { png_base64: b64([...PNG, ...new Array<number>(60).fill(0)]), max_bytes: 64n }],
    ['a declared cap above 64 KiB', { png_base64: b64(PNG), max_bytes: 65537n }],
    ['a zero cap', { png_base64: b64(PNG), max_bytes: 0n }],
    ['unpadded base64', { png_base64: b64(PNG).replace(/=+$/, ''), max_bytes: 64n }],
    ['url-safe base64', { png_base64: b64(PNG).replace(/\+/g, '-'), max_bytes: 64n }],
    ['nothing', { png_base64: '', max_bytes: 64n }],
  ])('refuses %s', (_why: string, icon: { png_base64: string; max_bytes: bigint }) => {
    expect(appIconSrc(icon)).toBeNull();
  });

  it('control: the oversize case is drawn once its cap admits it', () => {
    const bytes: number[] = [...PNG, ...new Array<number>(60).fill(0)];
    expect(appIconSrc({ png_base64: b64(bytes), max_bytes: 74n })).not.toBeNull();
  });
});
