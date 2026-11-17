import { describe, it, expect } from 'vitest';
import { parseAccountLink, hasAccountLinkParams } from '../account-link';

/** Real parsing only: every case goes through URLSearchParams as the page does. */
const parse = (query: string): ReturnType<typeof parseAccountLink> => parseAccountLink(new URLSearchParams(query));
const viaScheme = (inner: string): string => `link=${encodeURIComponent(`web+citadel://open?${inner}`)}`;

describe('parseAccountLink: accepted', () => {
  it('reads ?account=', () => {
    expect(parse('account=alice')).toEqual({ username: 'alice' });
  });

  it('reads ?account=&server=, a plain host and host:port', () => {
    expect(parse('account=alice&server=citadel.example.com')).toEqual({
      username: 'alice', server: 'citadel.example.com',
    });
    expect(parse('account=alice&server=127.0.0.1:12349')).toEqual({
      username: 'alice', server: '127.0.0.1:12349',
    });
  });

  it('reads a tenant host', () => {
    expect(parse('account=alice&server=acme.work.avarok.net')).toEqual({
      username: 'alice', server: 'acme.work.avarok.net',
    });
  });

  it('reads the protocol handler substitution ?link=web+citadel://open?...', () => {
    expect(parse(viaScheme('account=alice&server=acme.work.avarok.net'))).toEqual({
      username: 'alice', server: 'acme.work.avarok.net',
    });
    expect(parse(viaScheme('account=bob'))).toEqual({ username: 'bob' });
  });

  it('accepts a username at the registration rule\'s bounds', () => {
    expect(parse(`account=${'a'.repeat(3)}`)).toEqual({ username: 'aaa' });
    expect(parse(`account=${'a'.repeat(37)}`)).toEqual({ username: 'a'.repeat(37) });
  });
});

describe('parseAccountLink: refused', () => {
  it('is null with no link at all', () => {
    expect(parse('')).toBeNull();
    expect(parse('join=1')).toBeNull();
  });

  it('refuses usernames the registration rule refuses', () => {
    expect(parse('account=')).toBeNull();
    expect(parse('account=ab')).toBeNull();
    expect(parse(`account=${'a'.repeat(38)}`)).toBeNull();
    expect(parse('account=al%20ice')).toBeNull();
  });

  it('refuses control, format and other whitespace characters', () => {
    expect(parse('account=ali%0Ace')).toBeNull();
    expect(parse('account=ali%09ce')).toBeNull();
    // U+202E RIGHT-TO-LEFT OVERRIDE and U+200B ZERO WIDTH SPACE.
    expect(parse('account=ali%E2%80%AEce')).toBeNull();
    expect(parse('account=ali%E2%80%8Bce')).toBeNull();
  });

  it('refuses a server that is not a workspace address', () => {
    expect(parse('account=alice&server=javascript:alert(1)')).toBeNull();
    expect(parse('account=alice&server=https://evil.example')).toBeNull();
    expect(parse('account=alice&server=evil.example/path')).toBeNull();
    expect(parse('account=alice&server=a.b%0Ac.d')).toBeNull();
    expect(parse('account=alice&server=')).toBeNull();
    expect(parse(`account=alice&server=${'a'.repeat(260)}`)).toBeNull();
  });

  it('refuses extra, repeated or redirect parameters', () => {
    expect(parse('account=alice&next=/admin')).toBeNull();
    expect(parse('account=alice&password=hunter22')).toBeNull();
    expect(parse('account=alice&account=bob')).toBeNull();
    expect(parse('account=alice&server=a.com&server=b.com')).toBeNull();
    expect(parse('server=a.com')).toBeNull();
    expect(parse(`${viaScheme('account=alice')}&account=bob`)).toBeNull();
    expect(parse(`${viaScheme('account=alice')}&${viaScheme('account=bob')}`)).toBeNull();
  });

  it('refuses a scheme link that is not exactly web+citadel://open?...', () => {
    expect(parse(`link=${encodeURIComponent('javascript:alert(1)')}`)).toBeNull();
    expect(parse(`link=${encodeURIComponent('https://open?account=alice')}`)).toBeNull();
    expect(parse(`link=${encodeURIComponent('web+citadel://evil?account=alice')}`)).toBeNull();
    expect(parse(`link=${encodeURIComponent('web+citadel://open/x?account=alice')}`)).toBeNull();
    expect(parse(`link=${encodeURIComponent('web+citadel://u:p@open?account=alice')}`)).toBeNull();
    expect(parse(`link=${encodeURIComponent('web+citadel://open:1?account=alice')}`)).toBeNull();
    expect(parse(`link=${encodeURIComponent('web+citadel://open?account=alice#x')}`)).toBeNull();
    expect(parse('link=not a url')).toBeNull();
  });

  it('refuses a scheme link carrying extra or nested parameters', () => {
    expect(parse(viaScheme('account=alice&next=/admin'))).toBeNull();
    expect(parse(viaScheme(`link=${encodeURIComponent('web+citadel://open?account=alice')}`))).toBeNull();
    expect(parse(viaScheme('account=alice&server=javascript:alert(1)'))).toBeNull();
  });

  it('refuses an oversized scheme link', () => {
    expect(parse(viaScheme(`account=alice&server=${'a'.repeat(600)}`))).toBeNull();
  });
});

describe('hasAccountLinkParams', () => {
  it('sees malformed links too, so the page still clears them', () => {
    expect(hasAccountLinkParams(new URLSearchParams('account=ab'))).toBe(true);
    expect(hasAccountLinkParams(new URLSearchParams('link=x'))).toBe(true);
    expect(hasAccountLinkParams(new URLSearchParams('server=x'))).toBe(true);
    expect(hasAccountLinkParams(new URLSearchParams('join=1'))).toBe(false);
  });
});
