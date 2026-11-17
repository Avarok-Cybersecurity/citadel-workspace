// @vitest-environment node
/**
 * The host consumes COPIES of generated bindings: the SDK's (ts-rs output and AbiConstants.ts) and
 * the internal-HTTP wire's (citadel-ihttp-types), so the UI builds without the Rust tree. This
 * holds each copy to its source byte for byte, in both directions: a binding changed, added or
 * removed upstream fails here until it is re-copied.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BINDINGS, GENERATED_COPY, WIRE_BINDINGS, WIRE_GENERATED_COPY, type SdkSource } from './sdk-paths';

const tsFiles = (dir: string): string[] => readdirSync(dir).filter((f: string) => f.endsWith('.ts')).sort();

const COPIES: readonly (readonly [string, SdkSource, string, string])[] = [
  ['the SDK bindings', BINDINGS, GENERATED_COPY, 'AbiConstants.ts'],
  ['the internal-HTTP wire bindings', WIRE_BINDINGS, WIRE_GENERATED_COPY, 'IhttpFrameKind.ts'],
];

describe.each(COPIES)('the generated copy of %s', (_what: string, source: SdkSource, copy: string, marker: string) => {
  it.skipIf(!source.present)(`names exactly the files the source has (source: ${source.label})`, () => {
    expect(tsFiles(copy)).toEqual(tsFiles(source.path));
  });

  it.skipIf(!source.present)('every file equals its source byte for byte', () => {
    const differ: string[] = tsFiles(source.path).filter((f: string) =>
      !readFileSync(join(copy, f)).equals(readFileSync(join(source.path, f))));
    expect(differ).toEqual([]);
  });

  it(`the copy is present (${marker})`, () => {
    expect(tsFiles(copy)).toContain(marker);
  });
});
