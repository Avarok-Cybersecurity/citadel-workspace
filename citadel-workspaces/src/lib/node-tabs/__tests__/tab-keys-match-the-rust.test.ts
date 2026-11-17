/** The keys and the limit the UI offers are the ones the server enforces (node_tabs.rs). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_TABS_KEY, DEFAULT_APP_TABS_KEY, MAX_APP_TABS, TIME_ZONE_KEY } from '../tab-keys';

const RUST: string = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../citadel-workspace-types/src/node_tabs.rs');

describe('the node-tab keys', () => {
  const source: string = readFileSync(RUST, 'utf8');
  const constant = (name: string): string | undefined => new RegExp(`pub const ${name}: [^=]+= "?([^";]+)"?;`).exec(source)?.[1];

  it('name what the Rust names', () => {
    expect(constant('APP_TABS_KEY')).toBe(APP_TABS_KEY);
    expect(constant('DEFAULT_APP_TABS_KEY')).toBe(DEFAULT_APP_TABS_KEY);
    expect(Number(constant('MAX_APP_TABS'))).toBe(MAX_APP_TABS);
    expect(constant('TIME_ZONE_KEY')).toBe(TIME_ZONE_KEY);
  });
});
