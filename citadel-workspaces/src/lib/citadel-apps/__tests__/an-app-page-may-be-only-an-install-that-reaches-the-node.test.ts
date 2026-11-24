/**
 * Which installs "New app page" offers (page-candidates.ts, node-page-abi.md §1 and §3): one whose
 * release offers `node_page` and whose install scope reaches every reader of the new child, so the
 * page never reads "not available" to some of the people it was made for. No mocks: the rule is
 * pure, its inputs are real listings (the shared manifest base) and installs; the loader's source
 * is a pair of functions answering as the zone data port does.
 *
 * Negative controls (each applied, seen red, reverted): `reachesNewChild` accepting a Node install
 * of the parent fails "reaches the new child"; dropping the `node_page` check fails "offers a page";
 * dropping the Active check fails "only an Active install".
 */
import { describe, expect, it } from 'vitest';
import type { AppInstall, InstallScope } from 'citadel-workspace-client-ts';
import { listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import { installOf, listingOf } from '@/test/app-manifests';
import { loadPageCandidates, pageCandidates, reachesNewChild, type PageCandidate, type PageCandidates } from '../page-candidates';

const app = (id: string, surfaces: ('node_page' | 'node_tab' | 'md_zone')[]): ListedApp =>
  listedApps([listingOf({ id, name: id, version: '1.0.0', surfaces, scopes: ['workspace', 'node_tree'] })])[0];
const PAGE: ListedApp = app('work.page.app', ['node_page']);
const TAB: ListedApp = app('work.tab.app', ['node_tab']);
const LISTINGS: ReadonlyMap<string, ListedApp> = new Map([[PAGE.manifest.id, PAGE], [TAB.manifest.id, TAB]]);
const ids = (found: readonly PageCandidate[]): string[] => found.map((c: PageCandidate) => c.install.id);

describe('an install a new node’s page may be', () => {
  it('reaches the new child: workspace-wide or a tree rooted at the parent or above, never a node, people or one person', () => {
    const ancestors: string[] = ['floor', 'city'];
    const yes: InstallScope[] = ['Workspace', { NodeTree: 'room' }, { NodeTree: 'floor' }, { NodeTree: 'city' }];
    const no: InstallScope[] = [{ NodeTree: 'elsewhere' }, { Node: 'room' }, { Users: ['alice'] }, { SelfOnly: 'alice' }];
    expect(yes.map((s: InstallScope) => reachesNewChild(s, 'room', ancestors))).toEqual([true, true, true, true]);
    expect(no.map((s: InstallScope) => reachesNewChild(s, 'room', ancestors))).toEqual([false, false, false, false]);
  });

  it('offers a page: a tab-only release is not offered, a page release is', () => {
    const installs: AppInstall[] = [installOf(TAB.manifest.id, 'Workspace', { id: 'tab' }), installOf(PAGE.manifest.id, 'Workspace', { id: 'page' })];
    expect(ids(pageCandidates(installs, LISTINGS, 'room', []))).toEqual(['page']);
  });

  it('is only an Active install whose app has a listing', () => {
    const installs: AppInstall[] = [
      installOf(PAGE.manifest.id, 'Workspace', { id: 'suspended', state: { Suspended: { reason: 'publisher key revoked' } } }),
      installOf('work.unlisted.app', 'Workspace', { id: 'unlisted' }),
      installOf(PAGE.manifest.id, { NodeTree: 'room' }, { id: 'active' }),
    ];
    expect(ids(pageCandidates(installs, LISTINGS, 'room', []))).toEqual(['active']);
  });
});

describe('reading the candidates', () => {
  it('asks for the listing of only the apps whose installs reach here, and keeps the kernel’s order', async () => {
    const asked: string[] = [];
    const found: PageCandidates = await loadPageCandidates({
      installs: async () => ({ ok: true, value: [installOf(PAGE.manifest.id, 'Workspace', { id: 'a' }), installOf(TAB.manifest.id, { Node: 'room' }, { id: 'b' }), installOf(PAGE.manifest.id, { NodeTree: 'city' }, { id: 'c' })] }),
      listing: async (id: string) => { asked.push(id); return LISTINGS.has(id) ? { ok: true, value: LISTINGS.get(id) as ListedApp } : { ok: false, refusal: 'Unavailable' }; },
    }, 'room', ['floor', 'city']);
    expect(asked).toEqual([PAGE.manifest.id]);
    expect(found.kind === 'ready' ? ids(found.candidates) : found).toEqual(['a', 'c']);
  });

  it('says why when the installs cannot be read, and is not an empty list', async () => {
    const found: PageCandidates = await loadPageCandidates({ installs: async () => ({ ok: false, refusal: 'NoAnswer' }), listing: async () => ({ ok: false, refusal: 'NoAnswer' }) }, 'room', []);
    expect(found).toEqual({ kind: 'failed', why: 'The server did not answer. Check your connection and try again.' });
  });
});
