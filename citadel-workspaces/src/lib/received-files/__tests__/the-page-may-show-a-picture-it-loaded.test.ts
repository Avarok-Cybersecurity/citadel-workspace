/**
 * A chat picture is shown from an object URL (picture-io.ts: `URL.createObjectURL`), so the
 * page's Content-Security-Policy must let an <img> load a `blob:` URL.
 *
 * It did not: `img-src 'self' data:`. Every picture the cache loaded was refused by the
 * browser ("Loading the image 'blob:…' violates … img-src 'self' data:"), so the sender's own
 * bubble showed a broken image and the receiver's full-size picture could never load. Unit
 * tests of the cache saw a URL and passed; only the policy decides whether it is drawn.
 *
 * Both policies vite serves are read here. The parent's check-preview-csp-matches-production
 * holds nginx and the hosted Worker to PRODUCTION_CSP, so they are covered by that parity.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VITE_CONFIG: string = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf-8');

function policy(name: string): string {
  const found: RegExpExecArray | null = new RegExp(`const ${name}\\s*=\\s*\\n?\\s*"([^"]+)"`).exec(VITE_CONFIG);
  if (found === null) throw new Error(`${name} not found in vite.config.ts`);
  return found[1];
}

function imgSources(csp: string): string[] {
  const directive: string | undefined = csp.split(';').map((d: string): string => d.trim()).find((d: string): boolean => d.startsWith('img-src '));
  if (directive === undefined) throw new Error('the policy has no img-src');
  return directive.split(/\s+/).slice(1);
}

describe('the page may show a picture it loaded', () => {
  for (const name of ['PRODUCTION_CSP', 'DEV_CSP']) {
    it(`${name} lets an <img> load the blob: URL a picture is shown from`, () => {
      expect(imgSources(policy(name))).toContain('blob:');
    });

    it(`${name} still admits no remote image origin`, () => {
      // blob: and data: are documents this page made; a host source would let any page's
      // markup beacon out through an image.
      expect(imgSources(policy(name)).filter((s: string): boolean => /^(https?:|\*)/.test(s))).toEqual([]);
    });
  }
});
