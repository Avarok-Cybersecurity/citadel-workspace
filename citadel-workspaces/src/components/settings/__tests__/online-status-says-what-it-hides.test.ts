/**
 * The online-status switch stops presence broadcasts (presence-manager), but a peer with a
 * live direct connection still sees that connection. Measured live: with the switch off, the
 * other side kept "Connected, Direct". The copy must say so rather than promise invisibility.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source: string = readFileSync(join(process.cwd(), 'src/components/settings/PrivacyServerRows.tsx'), 'utf8');

describe('online status copy', () => {
  it('states that a direct connection stays visible', () => {
    expect(source).toContain('Someone you are connected to directly can still see that connection.');
    expect(source).not.toContain("Let others see when you're online");
  });
});
