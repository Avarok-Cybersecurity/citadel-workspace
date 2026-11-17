import { describe, it, expect, vi, afterEach  } from 'vitest';
import { resolveWebsocketUrl, readLoopbackAgentOrigin, isLoopbackHost, MissingWebsocketLocationError } from '../resolve-url';

/**
 * The browser reaches the local Citadel agent over exactly one URL, decided here. Get this wrong
 * and the app cannot connect at all - so the precedence and the scheme mapping are pinned.
 */
describe('resolveWebsocketUrl', () => {
  const http: { protocol: string; host: string; } = { protocol: 'http:', host: 'localhost:8080' };
  const https: { protocol: string; host: string; } = { protocol: 'https:', host: 'workspace.example.com' };

  it('defaults to a SAME-ORIGIN /ws path', () => {
    // This is the whole point: the production CSP is `connect-src 'self'`, so an off-origin
    // socket (the old `ws://localhost:12345`) is blocked by the browser outright.
    expect(resolveWebsocketUrl(undefined, undefined, http)).toBe('ws://localhost:8080/ws');
  });

  it('uses wss when the page is served over TLS', () => {
    // A page on https cannot open a plain `ws://` socket - browsers treat it as mixed content and
    // block it. Following the page scheme is what makes one build work on both.
    expect(resolveWebsocketUrl(undefined, undefined, https)).toBe('wss://workspace.example.com/ws');
  });

  it('carries the port through, since host includes it', () => {
    expect(resolveWebsocketUrl(undefined, undefined, { protocol: 'http:', host: '127.0.0.1:5291' }))
      .toBe('ws://127.0.0.1:5291/ws');
  });

  it('honours VITE_WS_URL over the same-origin default', () => {
    // Existing hosted deployments bake an absolute URL at build time. They must keep working
    // unchanged, so the build-time value still wins over the derived default.
    expect(resolveWebsocketUrl(undefined, 'wss://hosted.example.com/ws', http))
      .toBe('wss://hosted.example.com/ws');
  });

  it('honours an explicit config URL over everything', () => {
    expect(resolveWebsocketUrl('ws://explicit:1234', 'wss://build-time/ws', https))
      .toBe('ws://explicit:1234');
  });

  it('ignores empty-string overrides rather than emitting a broken URL', () => {
    // An unset `VITE_WS_URL` reaches Vite as `''`, not `undefined`. Treating that as "configured"
    // would hand the WebSocket an empty URL and fail at connect time with a useless error.
    expect(resolveWebsocketUrl('', '', http)).toBe('ws://localhost:8080/ws');
  });

  it('falls through an empty config URL to the build-time one', () => {
    // The precedence is expressed with `||`, which is load-bearing: `??` would treat the empty
    // string as "present" and return it, so a hosted deployment that bakes VITE_WS_URL would get
    // an empty socket URL the moment the config field existed but was blank.
    expect(resolveWebsocketUrl('', 'wss://build-time/ws', http)).toBe('wss://build-time/ws');
  });

  describe('without a browser location', () => {
    // The service must be constructible outside a browser (node test runner, SSR) without a
    // ReferenceError on `window`. What it must NOT do is silently invent a localhost default.
    it('throws a named, actionable error when it has nothing to derive from', () => {
      expect(() => resolveWebsocketUrl(undefined, undefined, undefined))
        .toThrow(MissingWebsocketLocationError);
    });

    it('still honours an explicit override, since nothing needs deriving', () => {
      expect(resolveWebsocketUrl('ws://agent:12345', undefined, undefined)).toBe('ws://agent:12345');
    });
  });

  describe('off-origin overrides', () => {
    // `connect-src 'self'` blocks these in a browser. The connection fails with an opaque error
    // that never mentions CSP, so the warning is the only thing standing between an operator and
    // a long debugging session. These tests pin that it fires, and that it does NOT cry wolf.
    const warn = (): ReturnType<typeof vi.spyOn> => vi.spyOn(console, 'warn').mockImplementation((): void => {});
    afterEach(() => vi.restoreAllMocks());

    it('warns that CSP will block an off-origin override', () => {
      const spy: ReturnType<typeof warn> = warn();
      resolveWebsocketUrl(undefined, 'wss://elsewhere.example.com/ws', http);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toMatch(/not same-origin|BLOCK/);
    });

    it('stays quiet for a same-origin override (wss on an https page)', () => {
      const spy: ReturnType<typeof warn> = warn();
      // `wss://h` and `https://h` are the same origin - baking this is legitimate and must not warn.
      expect(resolveWebsocketUrl(undefined, 'wss://workspace.example.com/ws', https))
        .toBe('wss://workspace.example.com/ws');
      expect(spy).not.toHaveBeenCalled();
    });

    it('stays quiet for a relative override, which is same-origin by construction', () => {
      const spy: ReturnType<typeof warn> = warn();
      resolveWebsocketUrl('/ws', undefined, http);
      expect(spy).not.toHaveBeenCalled();
    });

    it('warns on a same-host override that differs only by port', () => {
      const spy: ReturnType<typeof warn> = warn();
      // The exact regression this PR exists to kill: `ws://localhost:12345` from a page on :8080.
      resolveWebsocketUrl(undefined, 'ws://localhost:12345', http);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('never puts a credential from the URL into the log, wherever it hides', () => {
      const spy: ReturnType<typeof warn> = warn();
      // A websocket URL is a plausible place to park a token, and it can hide in any component:
      // the query, the userinfo, or a PATH SEGMENT. Console output gets swept into log collectors,
      // so the warning names the origin and nothing beyond it.
      resolveWebsocketUrl(
        undefined,
        'wss://user:hunter2@elsewhere.example/ws/token/PATHSECRET?access_token=QUERYSECRET',
        http,
      );
      const logged: string = String(spy.mock.calls[0][0]);
      expect(logged).not.toContain('QUERYSECRET');
      expect(logged).not.toContain('PATHSECRET');
      expect(logged).not.toContain('hunter2');
      expect(logged).toContain('elsewhere.example'); // still actionable
    });

    it('names the WEBSOCKET scheme in the warning, not the resolved http one', () => {
      const spy: ReturnType<typeof warn> = warn();
      // `//elsewhere.example/ws` resolves against the page to `http://…`, but the browser will dial
      // `ws://…`. Logging the http form would name a URL nobody ever requested.
      resolveWebsocketUrl(undefined, '//elsewhere.example/ws', http);
      const logged: string = String(spy.mock.calls[0][0]);
      expect(logged).toContain('ws://elsewhere.example');
      expect(logged).not.toContain('http://elsewhere.example');
    });

    it('warns on a PROTOCOL-RELATIVE override, which is off-origin despite having no scheme', () => {
      const spy: ReturnType<typeof warn> = warn();
      // `//elsewhere.example/ws` does not parse standalone, so a naive "unparseable means relative,
      // therefore same-origin" check waves it through - yet the browser resolves it against the
      // page scheme to an off-origin URL and CSP blocks it. Resolving against the page catches it.
      resolveWebsocketUrl(undefined, '//elsewhere.example/ws', http);
      expect(spy).toHaveBeenCalledOnce();
    });
  });
});

/**
 * A hosted page has no route to the visitor's agent through its own origin -- the public stack
 * keeps /ws off. The operator publishes `wss://local.<domain>:<port>` (a name that resolves to
 * 127.0.0.1) and the page must dial exactly that, and only from a page that is not itself local.
 */
describe('loopback agent origin', () => {
  const hosted: { protocol: string; host: string; } = { protocol: 'https:', host: 'work.example.com' };
  const local: { protocol: string; host: string; } = { protocol: 'http:', host: '127.0.0.1:8080' };
  const origin: string = 'wss://local.example.com:12345';

  it('dials the published loopback origin from a hosted page', () => {
    expect(resolveWebsocketUrl(undefined, undefined, hosted, origin)).toBe(origin);
  });

  it('ignores it when the page itself is on loopback -- same-origin /ws is the proxy there', () => {
    expect(resolveWebsocketUrl(undefined, undefined, local, origin)).toBe('ws://127.0.0.1:8080/ws');
    expect(resolveWebsocketUrl(undefined, undefined, { protocol: 'http:', host: 'localhost:5291' }, origin))
      .toBe('ws://localhost:5291/ws');
  });

  it('an explicit override still wins', () => {
    expect(resolveWebsocketUrl('wss://work.example.com/ws', undefined, hosted, origin))
      .toBe('wss://work.example.com/ws');
  });

  it('accepts only a bare wss origin -- a path, a plain ws scheme or junk falls back to /ws', () => {
    for (const bad of ['ws://local.example.com:12345', 'wss://local.example.com:12345/ws', 'javascript:alert(1)', 'wss://', '  ']) {
      expect(resolveWebsocketUrl(undefined, undefined, hosted, bad)).toBe('wss://work.example.com/ws');
    }
  });

  it('reads the meta the hosting nginx fills in, and treats an empty one as absent', () => {
    const doc = (content: string | null): { querySelector(): { getAttribute(): string | null } } => ({
      querySelector: () => ({ getAttribute: () => content }),
    });
    expect(readLoopbackAgentOrigin(doc(origin))).toBe(origin);
    expect(readLoopbackAgentOrigin(doc(''))).toBeUndefined();
    expect(readLoopbackAgentOrigin(doc(null))).toBeUndefined();
    expect(readLoopbackAgentOrigin({ querySelector: () => null })).toBeUndefined();
  });

  it("knows which hosts are the visitor's own machine", () => {
    for (const h of ['localhost', 'localhost:8080', 'app.localhost', '127.0.0.1:5291', '[::1]:8080']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['work.example.com', 'local.example.com:12345', '127.0.0.1.example.com']) expect(isLoopbackHost(h)).toBe(false);
  });
});
