/**
 * Where a link in author-supplied content is allowed to send you.
 *
 * The classifier is pure — the page it is being read on arrives as an argument
 * — so every one of these branches is exercised without a DOM or a router.
 */
import { describe, it, expect } from 'vitest';
import { classifyDocumentLink, type DocumentLinkTarget } from '../document-links';

const HERE: string = 'https://workspace.example/workspace?nodeId=start';

function classify(href: string | undefined): DocumentLinkTarget {
  return classifyDocumentLink(href, HERE);
}

describe('links that stay in the app', () => {
  it('routes a root-relative workspace link', () => {
    expect(classify('/workspace?nodeId=other')).toEqual({
      kind: 'internal',
      to: '/workspace?nodeId=other',
    });
  });

  it('routes a same-origin absolute URL, dropping the origin', () => {
    // The form someone gets by copying the address bar. Keeping the origin is
    // how a same-origin link sneaks back into a full page load.
    expect(classify('https://workspace.example/messages?channel=c1')).toEqual({
      kind: 'internal',
      to: '/messages?channel=c1',
    });
  });

  it('resolves a relative link against the page it was read on', () => {
    expect(classify('directory')).toEqual({ kind: 'internal', to: '/directory' });
  });

  it('keeps the fragment when routing', () => {
    expect(classify('/workspace?nodeId=n#section')).toEqual({
      kind: 'internal',
      to: '/workspace?nodeId=n#section',
    });
  });
});

describe('links that leave', () => {
  it('treats another origin as external', () => {
    expect(classify('https://example.com/spec')).toEqual({
      kind: 'external',
      href: 'https://example.com/spec',
    });
  });

  it('treats a protocol-relative host as external, not as a local path', () => {
    // `//evil.example/x` starts with a slash but is NOT same-origin. A
    // startsWith('/') test would have routed it into the app as a path.
    expect(classify('//evil.example/x')).toEqual({
      kind: 'external',
      href: 'https://evil.example/x',
    });
  });

  it('allows mailto and tel through to the OS', () => {
    expect(classify('mailto:someone@example.com').kind).toBe('external');
    expect(classify('tel:+15551234').kind).toBe('external');
  });
});

describe('links that are refused', () => {
  it('refuses a javascript: href', () => {
    expect(classify('javascript:alert(1)')).toEqual({ kind: 'inert' });
  });

  it('refuses a javascript: href however it is spelled', () => {
    // The URL parser strips tabs and newlines, which is what these tricks rely
    // on, and lowercases the scheme — so obfuscation collapses to the same
    // protocol rather than slipping past a string comparison.
    expect(classify('JaVaScRiPt:alert(1)')).toEqual({ kind: 'inert' });
    expect(classify('java\tscript:alert(1)')).toEqual({ kind: 'inert' });
    expect(classify('  javascript:alert(1)  ')).toEqual({ kind: 'inert' });
    expect(classify('java\nscript:alert(1)')).toEqual({ kind: 'inert' });
  });

  it('refuses data: and other schemes not on the allowlist', () => {
    expect(classify('data:text/html;base64,PHNjcmlwdD4=')).toEqual({ kind: 'inert' });
    expect(classify('vbscript:msgbox(1)')).toEqual({ kind: 'inert' });
    expect(classify('file:///etc/passwd')).toEqual({ kind: 'inert' });
  });

  it('refuses an absent or empty href', () => {
    expect(classify(undefined)).toEqual({ kind: 'inert' });
    expect(classify('')).toEqual({ kind: 'inert' });
    expect(classify('   ')).toEqual({ kind: 'inert' });
  });
});

describe('an in-page anchor', () => {
  it('stays a plain anchor rather than becoming a route', () => {
    // Routing a bare fragment would push a history entry for what is a scroll.
    expect(classify('#details')).toEqual({ kind: 'hash', href: '#details' });
  });
});
