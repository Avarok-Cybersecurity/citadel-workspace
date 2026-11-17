/**
 * The predicate that decides whether CI's best-practices shortfall is the set
 * of known, expected conditions — or a real problem.
 *
 * Worth testing directly because the condition is awkward to reproduce on
 * demand: it needs the agent absent AND the failure to surface inside
 * Lighthouse's collection window. Pointing the proxy at a dead port locally did
 * NOT reproduce it — the audit finished first and scored 96 — so a
 * browser-driven check would have proved nothing while looking green.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper shared with the CI script, no types.
import { explainShortfall } from '../lighthouse-shortfall.mjs';

const category = (ids: string[]) => ({ auditRefs: ids.map((id) => ({ id })) });

/** errors-in-console reports messages. */
const audit = (id: string, score: number, messages: string[] = []) => [
  id,
  { id, score, details: { items: messages.map((description) => ({ description })) } },
];

/** valid-source-maps reports script URLs. */
const maps = (urls: string[]) => [
  'valid-source-maps',
  { id: 'valid-source-maps', score: 0, details: { items: urls.map((scriptUrl) => ({ scriptUrl })) } },
];

/** inspector-issues reports a table of issueType. */
const issues = (types: string[]) => [
  'inspector-issues',
  { id: 'inspector-issues', score: 0, details: { items: types.map((issueType) => ({ issueType })) } },
];

const ABSENT_AGENT =
  'Failed to initialize WASM client: WebSocket connection failed: ConnectionFailed { event: CloseEvent { code: 1006 } }';

const verdict = (ids: string[], entries: unknown[][]) =>
  explainShortfall(category(ids), Object.fromEntries(entries as never));

describe('explainShortfall', () => {
  it('accepts the console shortfall CI reports', () => {
    const v = verdict(
      ['errors-in-console'],
      [audit('errors-in-console', 0, [ABSENT_AGENT, 'Connection error: Failed to initialize WASM client'])],
    );
    expect(v.expected).toBe(true);
  });

  it("accepts the browser's own handshake-failure wording", () => {
    // Chrome says "WebSocket connection TO '...' failed", not "WebSocket
    // connection failed". Missing that one variant kept CI red for a full
    // cycle while every message in the printout looked familiar.
    const v = verdict(
      ['errors-in-console'],
      [
        audit('errors-in-console', 0, [
          ABSENT_AGENT,
          "WebSocket connection to 'ws://localhost:4173/ws' failed: Connection closed before receiving a handshake response",
        ]),
      ],
    );
    expect(v.expected).toBe(true);
  });

  it('accepts all three known audits together, as CI reports them', () => {
    const v = verdict(
      ['errors-in-console', 'valid-source-maps', 'inspector-issues'],
      [
        audit('errors-in-console', 0, [ABSENT_AGENT]),
        maps(['http://localhost:4173/wasm/client_bg.wasm']),
        issues(['Content security policy']),
      ],
    );
    expect(v.expected).toBe(true);
  });

  it('rejects a console error that is not the absent agent, and says which', () => {
    // The point of the whole predicate: a real error hiding among expected ones.
    const v = verdict(
      ['errors-in-console'],
      [audit('errors-in-console', 0, [ABSENT_AGENT, 'TypeError: cannot read x of undefined'])],
    );
    expect(v.expected).toBe(false);
    expect(v.reason).toContain('TypeError');
  });

  it('rejects an unrecognised audit, and names it', () => {
    const v = verdict(
      ['errors-in-console', 'deprecations'],
      [audit('errors-in-console', 0, [ABSENT_AGENT]), audit('deprecations', 0, ['old api'])],
    );
    expect(v.expected).toBe(false);
    expect(v.reason).toContain('deprecations');
  });

  it('rejects a source-map miss on a third-party script', () => {
    const v = verdict(['valid-source-maps'], [maps(['https://cdn.example.com/thing.js'])]);
    expect(v.expected).toBe(false);
    expect(v.reason).toContain('cdn.example.com');
  });

  it('accepts a source-map miss on our own assets', () => {
    // Lighthouse FETCHES each map, so under load it reports missing against a
    // build whose maps are correct. check-source-maps.mjs is the deterministic
    // guard; this only stops the flaky version reddening the build.
    const v = verdict(['valid-source-maps'], [maps(['http://localhost:4173/assets/app-services-x.js'])]);
    expect(v.expected).toBe(true);
  });

  it('rejects an inspector issue that is not the policy', () => {
    const v = verdict(['inspector-issues'], [issues(['Content security policy', 'Mixed content'])]);
    expect(v.expected).toBe(false);
    expect(v.reason).toContain('Mixed content');
  });

  it('excuses nothing when nothing is failing', () => {
    const v = verdict(['errors-in-console'], [audit('errors-in-console', 1, [])]);
    expect(v.expected).toBe(false);
  });

  it('rejects a known audit that lists nothing to identify it by', () => {
    const v = verdict(['errors-in-console'], [audit('errors-in-console', 0, [])]);
    expect(v.expected).toBe(false);
    expect(v.reason).toContain('nothing to identify');
  });
});
