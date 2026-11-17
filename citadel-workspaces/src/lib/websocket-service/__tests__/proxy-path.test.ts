import { describe, it, expect } from 'vitest';
import { stripWsPrefix } from '../proxy-path';

/**
 * These pin the dev proxy to what production nginx does: `proxy_pass http://<upstream>/` strips the
 * matched `/ws` prefix, so the agent sees `/`. Drift here means dev and production disagree about
 * what reaches the agent, which is the class of bug this change exists to remove.
 */
describe('stripWsPrefix', () => {
  it('turns the bare /ws into /', () => {
    // The case that actually runs: the app connects to `/ws`, and the agent must receive `/`.
    expect(stripWsPrefix('/ws')).toBe('/');
  });

  it('never returns an empty path', () => {
    // An empty request target is not a valid HTTP request line. Without the `|| '/'` fallback the
    // bare-prefix case above would produce exactly that, and the handshake would fail obscurely.
    expect(stripWsPrefix('/ws')).not.toBe('');
  });

  it('preserves a subpath after the prefix', () => {
    expect(stripWsPrefix('/ws/foo')).toBe('/foo');
  });

  it('preserves a subpath AND its query together', () => {
    // The one combination the other cases miss: the lookahead matches on `/`, the remainder
    // already starts with `/`, so the rooting branch must not fire and add a second one.
    expect(stripWsPrefix('/ws/foo?t=1')).toBe('/foo?t=1');
  });

  it('keeps a query string on a rooted path, exactly as nginx does', () => {
    // Observed from the production proxy: `/ws?token=abc` reaches the agent as
    // `GET /?token=abc HTTP/1.1`. Returning a bare `?token=abc` would be both an invalid request
    // target and a divergence from production - the one thing this module exists to prevent.
    expect(stripWsPrefix('/ws?token=abc')).toBe('/?token=abc');
  });

  it('always returns a rooted path', () => {
    for (const input of ['/ws', '/ws/foo', '/ws?t=1', '/ws/foo?t=1']) {
      expect(stripWsPrefix(input).startsWith('/')).toBe(true);
    }
  });

  it('only strips the prefix at the START of the path', () => {
    // `/proxy/ws` is not a `/ws` request; rewriting it would corrupt an unrelated path.
    expect(stripWsPrefix('/proxy/ws')).toBe('/proxy/ws');
  });

  it('treats /ws as a whole SEGMENT, not merely a leading substring', () => {
    // The bug this guards: a bare `/^\/ws/` also matches any route that just begins with those
    // two letters, so `/wsfoo` would be rewritten to `/foo` - a different, unrelated route.
    // nginx's `location = /ws` never does that, and neither must this.
    for (const untouched of ['/wsfoo', '/ws123', '/wsbar/baz', '/wsettings']) {
      expect(stripWsPrefix(untouched)).toBe(untouched);
    }
  });

  it('leaves an unrelated path untouched', () => {
    expect(stripWsPrefix('/assets/app.js')).toBe('/assets/app.js');
  });
});
