/**
 * The page's copy of the first-party publisher keys is the kernel's list, key for key.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIRST_PARTY_PUBLISHER_KEYS } from '../publisher-keys';

const INSTALL_RS: string = resolve(__dirname, '../../../../../../citadel-workspace-server-kernel/src/kernel/apps/install.rs');

function kernelKeys(): string[] {
  const source: string = readFileSync(INSTALL_RS, 'utf8');
  const list: RegExpMatchArray | null = source.match(/pub const FIRST_PARTY_PUBLISHER_KEYS: &\[&str\] = &\[([^\]]*)\];/);
  if (list === null) throw new Error('install.rs no longer declares FIRST_PARTY_PUBLISHER_KEYS as a string list');
  return [...list[1].matchAll(/"([0-9a-f]+)"/g)].map((m: RegExpMatchArray): string => m[1]);
}

describe('the first-party publisher keys', () => {
  it('are the kernel’s', () => {
    expect([...FIRST_PARTY_PUBLISHER_KEYS]).toEqual(kernelKeys());
  });
});
