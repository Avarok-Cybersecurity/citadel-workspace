/**
 * The Citadel App registry: every id has exactly one entry, R1 ships Docs only (at every
 * creation site), and there is no default app to fall back on. No mocks.
 */
import { describe, it, expect } from 'vitest';
import * as registry from '../registry';
import { CITADEL_APPS, CITADEL_APP_IDS, DOCUMENT_CREATION_SITES, citadelApp, creatableIn, isCitadelAppId, isFileOpeningAppId, type CitadelApp } from '../registry';
import { DOCS_IMPORT_FORMATS } from '../docs-import-formats';

describe('the Citadel App registry', () => {
  it('has one entry per id, each with a name and icon', () => {
    expect(CITADEL_APPS.map((app: CitadelApp): string => app.id)).toEqual([...CITADEL_APP_IDS]);
    for (const id of CITADEL_APP_IDS) {
      const app: CitadelApp = citadelApp(id);
      expect(app.name).not.toBe('');
      expect(app.icon).toBeTruthy();
    }
  });

  it('offers Docs at every creation site and lists PDF and LaTeX as not yet available anywhere', () => {
    for (const site of DOCUMENT_CREATION_SITES) {
      const offered: string[] = CITADEL_APPS.filter((app: CitadelApp): boolean => creatableIn(app, site)).map((app: CitadelApp): string => app.id);
      expect(offered, site).toEqual(['docs']);
    }
  });

  it('names only real creation sites', () => {
    for (const app of CITADEL_APPS) for (const site of app.createdIn) expect(DOCUMENT_CREATION_SITES).toContain(site);
  });

  it('has no default app: nothing exported names one, and unknown ids are refused', () => {
    expect(Object.keys(registry).filter((key: string): boolean => /default/i.test(key))).toEqual([]);
    for (const value of [undefined, null, '', 'Docs', 'sheets', 0]) expect(isCitadelAppId(value)).toBe(false);
  });

  it('declares for each app exactly the files it really opens: Docs its importers, PDF and LaTeX nothing yet', () => {
    // docs.opens.json is checked by the manifest's rule in Rust; here it is held to the engine's importers.
    expect(citadelApp('docs').opens).toEqual([...DOCS_IMPORT_FORMATS]);
    expect(citadelApp('pdf').opens).toEqual([]);
    expect(citadelApp('latex').opens).toEqual([]);
  });

  it('lets only an app with a screen a file opens in declare files', () => {
    for (const app of CITADEL_APPS) if (app.opens.length > 0) expect(isFileOpeningAppId(app.id), app.id).toBe(true);
  });
});
