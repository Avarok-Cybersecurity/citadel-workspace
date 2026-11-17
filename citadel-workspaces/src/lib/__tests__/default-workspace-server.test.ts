import { describe, it, expect } from 'vitest';
import { readDefaultWorkspaceServer, DEFAULT_SERVER_META } from '@/lib/default-workspace-server';

/** A stand-in for `document` that answers one meta query. */
function pageWith(content: string | null): { querySelector(s: string): { getAttribute(n: string): string | null } | null } {
  return {
    querySelector(selector: string): { getAttribute(n: string): string | null } | null {
      if (selector !== `meta[name="${DEFAULT_SERVER_META}"]`) return null;
      return content === null ? null : { getAttribute: (): string | null => content };
    },
  };
}

describe('the workspace server a deployment publishes', () => {
  it('is read from the meta the hosting nginx fills in', () => {
    expect(readDefaultWorkspaceServer(pageWith('citadel.avarok.net:12400'))).toBe('citadel.avarok.net:12400');
  });

  it('accepts a bare hostname and hands back the address with its assumed port', () => {
    // An operator publishing `citadel.avarok.net` means the default port, the
    // same as a user typing it. The field is pre-filled with what will be
    // dialled, so what they see is what happens.
    expect(readDefaultWorkspaceServer(pageWith('citadel.avarok.net'))).toBe('citadel.avarok.net:12400');
  });

  it('is undefined when the operator published nothing', () => {
    // The local-build case, and any deployment whose operator has not set it:
    // the wizard must then ask, exactly as it always did.
    expect(readDefaultWorkspaceServer(pageWith(''))).toBeUndefined();
    expect(readDefaultWorkspaceServer(pageWith('   '))).toBeUndefined();
    expect(readDefaultWorkspaceServer(pageWith(null))).toBeUndefined();
  });

  it('accepts an IP address and a high port', () => {
    expect(readDefaultWorkspaceServer(pageWith('51.81.107.44:12400'))).toBe('51.81.107.44:12400');
  });

  it('REFUSES anything the address field would not accept', () => {
    // A bad injection must leave the field empty and visibly unhelpful, rather
    // than pre-filling something the user has to notice is wrong and delete.
    // Every one of these is a plausible operator typo.
    for (const bad of [
      // NOT a bare hostname: that is now legitimate. The port is assumed when
      // absent (see workspace-address.ts), so an operator may publish
      // `citadel.avarok.net` and mean `citadel.avarok.net:12400`.
      'wss://citadel.avarok.net:12400',     // a scheme, copied from the agent origin
      'https://citadel.avarok.net:12400',
      'citadel.avarok.net:12400/',          // a path
      'citadel.avarok.net:12400\tstray',   // whitespace INSIDE, which trim cannot fix
      ':12400',
      'citadel.avarok.net:',
      'citadel avarok.net:12400',
      '-leading-hyphen.net:12400',
    ]) {
      expect(readDefaultWorkspaceServer(pageWith(bad)), `should refuse ${JSON.stringify(bad)}`).toBeUndefined();
    }
  });

  it('is trimmed, because envsubst and YAML both leave whitespace behind', () => {
    expect(readDefaultWorkspaceServer(pageWith('  citadel.avarok.net:12400  '))).toBe('citadel.avarok.net:12400');
  });
});

/**
 * The wiring, not the reader.
 *
 * A reader nothing calls is the failure mode this codebase keeps hitting: the
 * code runs, the fallback renders, and the feature is inert. So assert that
 * ServerConnect actually consults it, and in the right order -- an explicitly
 * supplied address must still win, or adding an account to an existing
 * workspace would silently retarget a different server.
 */
describe('ServerConnect consults it', () => {
  it('imports the reader and uses it after the explicit sources', async () => {
    const fs: typeof import('node:fs') = await import('node:fs');
    const source: string = fs.readFileSync('src/components/ServerConnect.tsx', 'utf8');
    expect(source, 'ServerConnect must import the reader').toContain('readDefaultWorkspaceServer');

    const init: RegExpMatchArray | null = source.match(/useState\(\s*([^)]*?)\s*,?\s*\)/s);
    expect(init, 'the address useState initialiser must be findable').not.toBeNull();
    const expr: string = init![1];
    expect(expr).toContain('defaultServer');
    expect(expr).toContain('initialAddress');
    expect(expr).toContain('publishedDefault');
    // Order: explicit prop, then the user's own input, then the deployment's.
    expect(expr.indexOf('defaultServer')).toBeLessThan(expr.indexOf('publishedDefault'));
    expect(expr.indexOf('initialAddress')).toBeLessThan(expr.indexOf('publishedDefault'));
  });
});
