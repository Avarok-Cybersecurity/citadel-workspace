/**
 * The global catalogue file and the listings built from it and from the kernel: the file is read
 * strictly (a wrong shape whole, a wrong entry on its own), the repository's catalogue reads, and
 * listings are one per origin and app, searchable by name, summary and category.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readCatalogue, SIGNATURE_HEX_CHARS, type CatalogueReading } from '../manifest/catalogue-format';
import { GLOBAL_CATALOGUE_URL, listedApps, loadGlobalCatalogue, searchApps, findListedApp, type GlobalCatalogue, type ListedApp } from '../listing-model';
import { listingOf, manifestJson, type ManifestChanges } from '@/test/app-manifests';

const REPO_CATALOGUE: string = resolve(__dirname, '../../../../../apps/catalogue/catalogue.json');
const b64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const entry = (c: ManifestChanges = {}, over: Record<string, unknown> = {}): Record<string, unknown> => {
  const m: Record<string, unknown> = manifestJson(c);
  return { id: m.id, version: m.version, manifest_url: 'https://acme.example/kanban/manifest.json', manifest_base64: b64(JSON.stringify(m)), signature: 'a'.repeat(SIGNATURE_HEX_CHARS), ...over };
};
const file = (entries: unknown[], over: Record<string, unknown> = {}): string => JSON.stringify({ format: 1, catalogue_version: 3, entries, ...over });
const problems = (r: CatalogueReading): string[] => (r.ok ? r.problems : [r.why]);

describe('the global catalogue file', () => {
  it('the repository’s catalogue reads, with nothing refused', () => {
    const r: CatalogueReading = readCatalogue(readFileSync(REPO_CATALOGUE, 'utf8'));
    expect(r.ok && r.problems).toEqual([]);
  });

  it('reads a valid entry; control for each refusal below', () => {
    const r: CatalogueReading = readCatalogue(file([entry()]));
    expect(r.ok && r.entries.map((e) => e.manifest.id)).toEqual(['com.acme.kanban']);
    expect(r.ok && r.catalogueVersion).toBe(3n);
  });

  it.each([
    ['not JSON', '{'],
    ['an extra top-level key', file([], { extra: 1 })],
    ['another format', file([], { format: 2 })],
    ['a version that is not a positive integer', file([], { catalogue_version: 0 })],
  ])('refuses a file with %s', (_why: string, text: string) => {
    expect(readCatalogue(text).ok).toBe(false);
  });

  it.each([
    ['an extra key', entry({}, { note: 'x' })],
    ['a manifest_url that is not https', entry({}, { manifest_url: 'http://acme.example/m.json' })],
    ['a short signature', entry({}, { signature: 'a'.repeat(10) })],
    ['a signature in capitals', entry({}, { signature: 'A'.repeat(SIGNATURE_HEX_CHARS) })],
    ['unpadded base64', entry({}, { manifest_base64: b64(JSON.stringify(manifestJson())).replace(/=+$/, '') + 'x' })],
    ['a manifest the rules refuse', entry({ id: 'Kanban' }, { id: 'Kanban' })],
    ['an id that differs from the manifest', entry({}, { id: 'com.acme.other' })],
    ['a version that differs from the manifest', entry({}, { version: '9.9.9' })],
    ['a workspace audience', entry({ audience: { kind: 'workspace' } })],
  ])('leaves out an entry with %s, and says so', (_why: string, e: Record<string, unknown>) => {
    const r: CatalogueReading = readCatalogue(file([e, entry({ id: 'com.acme.notes' })]));
    expect(r.ok && r.entries.map((x) => x.entry.id)).toEqual(['com.acme.notes']);
    expect(problems(r)).toHaveLength(1);
  });

  it('a second entry for an id is refused', () => {
    expect(problems(readCatalogue(file([entry(), entry()])))[0]).toContain('a second entry for this id');
  });

  it('is fetched from the same-origin static URL, and a failed fetch is a reason, not an exception', async () => {
    const asked: string[] = [];
    const ok: GlobalCatalogue = await loadGlobalCatalogue(async (url: string): Promise<string> => { asked.push(url); return file([entry()]); });
    expect(asked).toEqual([GLOBAL_CATALOGUE_URL]);
    expect(ok.ok && ok.listings[0].source).toEqual({ Global: { catalogue_version: 3n } });
    expect(await loadGlobalCatalogue(async (): Promise<string> => { throw new Error('404'); })).toEqual({ ok: false, why: '404' });
  });
});

describe('listings', () => {
  const kanban: ListedApp[] = listedApps([listingOf({ id: 'com.acme.kanban', name: 'Kanban', summary: 'Cards in columns', categories: ['planning'] })]);

  it('one per origin and app, the highest version kept, unreadable ones left out', () => {
    const apps: ListedApp[] = listedApps([
      listingOf({ id: 'com.acme.kanban', version: '1.0.0' }), listingOf({ id: 'com.acme.kanban', version: '2.0.0' }),
      listingOf({ id: 'com.acme.kanban' }, 'workspace'),
      { ...listingOf({ id: 'com.acme.broken' }), manifest_bytes: [123] },
    ]);
    expect(apps.map((a) => [a.origin, a.manifest.version])).toEqual([['global', '2.0.0'], ['workspace', '1.4.0']]);
    expect(findListedApp(apps, 'com.acme.kanban')?.origin).toBe('workspace');
  });

  it('search matches every word against name, summary and category, ignoring case', () => {
    expect(searchApps(kanban, 'KANBAN')).toHaveLength(1);
    expect(searchApps(kanban, 'cards planning')).toHaveLength(1);
    expect(searchApps(kanban, 'cards design')).toHaveLength(0);
    expect(searchApps(kanban, '   ')).toHaveLength(1);
  });
});
