/**
 * The installed app must accept `web+citadel:` links, or the menu-bar app's
 * "open at this account" reaches the website instead: a PWA shim drops the
 * https URL a native app hands it, and only a registered scheme gets through.
 *
 * Reads the real vite config, comments stripped so prose cannot satisfy it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAccountLink } from '@/lib/onboarding/account-link';

const code: string = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

describe('the web app manifest', () => {
  it('registers web+citadel and hands it to the landing page as ?link=', () => {
    const handler: RegExpMatchArray | null = code.match(
      /protocol_handlers:\s*\[\s*\{\s*protocol:\s*'web\+citadel',\s*url:\s*'(\/\?link=%s)'\s*\}\s*\]/,
    );
    expect(handler, 'no web+citadel protocol handler in the manifest').not.toBeNull();

    // And the URL it produces is one the landing page actually reads.
    const substituted: string = handler![1].replace(
      '%s', encodeURIComponent('web+citadel://open?account=alice'),
    );
    const query: URLSearchParams = new URL(substituted, 'https://work.avarok.net').searchParams;
    expect(parseAccountLink(query)).toEqual({ username: 'alice' });
  });

  it('reuses the open window rather than stacking another', () => {
    expect(code).toMatch(/launch_handler:\s*\{\s*client_mode:\s*'navigate-existing'\s*\}/);
  });
});
