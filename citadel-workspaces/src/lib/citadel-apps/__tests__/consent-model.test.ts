/**
 * The consent model: rows for every capability, hosts one by one, what the installer cannot
 * grant, what Install sends, the "can never" list, the key's history, the scope sentence and the
 * overlay guard's rule. Each guard sits beside its control.
 */
import { describe, expect, it } from 'vitest';
import type { AppInstall, AppManifest } from 'citadel-workspace-client-ts';
import { canNever, consentRows, grantOf, grantProblem, keyTrust, keyTrustCopy, type ConsentRow } from '../consent-model';
import { gateOpen, gateReducer, HIDDEN_GATE, msUntilElapsed, type GateState } from '../consent-gate';
import { scopeSentence } from '../scope-sentence';
import type { Authority, Tri } from '../scope-options';
import { readManifestBytes, type ManifestReading } from '../manifest/manifest-rules';
import { cap, installOf, listingOf, OTHER_KEY, PUBLISHER_KEY } from '@/test/app-manifests';

const manifest = (caps: Parameters<typeof cap>[]): AppManifest => {
  const r: ManifestReading = readManifestBytes(Uint8Array.from(listingOf({ capabilities: caps.map((c) => cap(...c)) }).manifest_bytes));
  if (!r.ok) throw new Error(r.field);
  return r.manifest;
};
const all: Authority = { holds: (): Tri => 'yes' };
const only = (...held: string[]): Authority => ({ holds: (p: string): Tri => (held.includes(p) ? 'yes' : 'no') });

describe('consent rows', () => {
  const m: AppManifest = manifest([['canvas'], ['nodes.read'], ['storage.user', true], ['net.server', true, ['api.acme.com', 'sync.acme.com:8443']]]);

  it('lists every capability with the publisher’s reason, its risk, and each host on its own', () => {
    const rows: ConsentRow[] = consentRows(m, new Set(), all, 'root');
    expect(rows.map((r) => [r.cap, r.risk, r.on])).toEqual([['canvas', 'low', true], ['nodes.read', 'medium', true], ['storage.user', 'low', true], ['net.server', 'high', true]]);
    expect(rows[3].hosts).toEqual(['api.acme.com', 'sync.acme.com:8443']);
    expect(rows[1].why).toBe('Needs nodes.read');
  });

  it('an optional capability turned off is left out of the grant; a required one cannot be', () => {
    const rows: ConsentRow[] = consentRows(m, new Set(['net.server', 'nodes.read'] as const), all, 'root');
    expect(grantOf(rows)).toEqual(['canvas', 'nodes.read', 'storage.user']);
  });

  it('a required capability the installer cannot grant blocks Install; control: granted, it does not', () => {
    const rows: ConsentRow[] = consentRows(m, new Set(), only('AppInstall'), 'root');
    expect(rows[1].blocked).toContain('Let an app read pages');
    expect(grantProblem(rows)).toContain('Read pages and what they contain');
    expect(grantProblem(consentRows(m, new Set(), only('AppInstall', 'AppInstallAllowNodeRead'), 'root'))).toBeNull();
  });

  it('an optional capability the installer cannot grant is off, not a blocker', () => {
    const rows: ConsentRow[] = consentRows(m, new Set(), only('AppInstall', 'AppInstallAllowNodeRead'), 'root');
    expect(rows[2]).toMatchObject({ cap: 'storage.user', on: false });
    expect(grantOf(rows)).toEqual(['canvas', 'nodes.read']);
  });

  it('documents is first-party only, whatever the installer holds', () => {
    expect(consentRows(manifest([['documents']]), new Set(), all, 'root')[0].blocked).toBe('Only apps published by Avarok may have this.');
  });

  it('says the app can never reach the network when no network capability is on; control: it does not when one is', () => {
    const off: ConsentRow[] = consentRows(m, new Set(['net.server'] as const), all, 'root');
    expect(canNever(off)).toContain('Reach the internet or your network');
    expect(canNever(consentRows(m, new Set(), all, 'root'))).not.toContain('Reach the internet or your network');
    expect(canNever(off)).toContain('Change roles or who may do what');
  });
});

describe('the publisher key’s history and the scope sentence', () => {
  it('first time for a key no install pinned; known for one other apps use', () => {
    expect(keyTrust(PUBLISHER_KEY, [installOf('com.acme.kanban', 'Workspace')], 'com.acme.kanban')).toEqual({ kind: 'first-time' });
    const others: AppInstall[] = [installOf('com.acme.a', 'Workspace'), installOf('com.acme.b', 'Workspace'), installOf('com.x.c', 'Workspace', { pinned_publisher_key: OTHER_KEY })];
    expect(keyTrustCopy(keyTrust(PUBLISHER_KEY, others, 'com.acme.kanban'))).toBe('Same key as 2 apps you already use.');
  });

  it('names who an install reaches, with the count when known', () => {
    const name = (id: string): string | null => (id === 'n-1' ? 'Engineering' : null);
    expect(scopeSentence({ NodeTree: 'n-1' }, { people: 42, pagesBelow: 12 }, name)).toBe('Everyone on “Engineering” and the 12 pages below it: 42 people');
    expect(scopeSentence('Workspace', { people: null, pagesBelow: null }, name)).toBe('Everyone in this workspace');
    expect(scopeSentence({ Users: ['alice', 'bob'] }, { people: 2, pagesBelow: null }, name)).toBe('alice and bob: 2 people');
    expect(scopeSentence({ SelfOnly: 'alice' }, { people: 1, pagesBelow: null }, name)).toBe('Just you');
  });
});

describe('the overlay guard', () => {
  const at = (s: GateState, ...events: Parameters<typeof gateReducer>[1][]): GateState => events.reduce(gateReducer, s);

  it('opens only after 600 ms shown AND a pointer move', () => {
    const shown: GateState = at(HIDDEN_GATE, { kind: 'shown', at: 1000 });
    expect(gateOpen(at(shown, { kind: 'clock', at: 5000 }))).toBe(false);
    const moved: GateState = at(shown, { kind: 'moved' });
    expect(gateOpen(at(moved, { kind: 'clock', at: 1599 }))).toBe(false);
    expect(gateOpen(at(moved, { kind: 'clock', at: 1600 }))).toBe(true);
  });

  it('a move before the panel showed does not count, and hiding starts again', () => {
    const early: GateState = at(HIDDEN_GATE, { kind: 'moved' }, { kind: 'shown', at: 0 });
    expect(gateOpen(at(early, { kind: 'clock', at: 10_000 }))).toBe(false);
    const hidden: GateState = at(early, { kind: 'moved' }, { kind: 'clock', at: 700 }, { kind: 'hidden' }, { kind: 'shown', at: 9000 }, { kind: 'moved' });
    expect(gateOpen(hidden)).toBe(false);
    expect(gateOpen(at(hidden, { kind: 'clock', at: 9500 }))).toBe(false);
    expect(gateOpen(at(hidden, { kind: 'clock', at: 9600 }))).toBe(true);
  });

  it('time left until open never goes below zero', () => {
    expect(msUntilElapsed(1000, 1000)).toBe(600);
    expect(msUntilElapsed(1000, 1599)).toBe(1);
    expect(msUntilElapsed(1000, 1600)).toBe(0);
    expect(msUntilElapsed(1000, 99_999)).toBe(0);
  });
});
