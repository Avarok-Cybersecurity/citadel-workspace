/**
 * The one lookup every surface asks: which apps open a file, preferred first, and what its menu
 * and its activation offer. Pure, no mocks; the apps are plain values (two of them stand in for
 * openers that do not exist yet, so "several apps" can be decided at all).
 */
import { describe, expect, it } from 'vitest';
import { FileText, FileType } from 'lucide-react';
import { BUILT_IN_OPENERS } from '../built-in-openers';
import { activationOf, fileMenuModel, openersFor, openLabel, type FileMenuModelOf, type FileOpener, type Opener, type OpenersOf } from '../openers';

type App = Opener<string>;
const DOCS: App = { id: 'docs', name: 'Citadel Docs', icon: FileText, firstParty: true, opens: ['docx', 'md', 'txt'] };
const PAD: App = { id: 'pad', name: 'Pad', icon: FileType, firstParty: false, opens: ['md', 'gz'] };
const NOTES: App = { id: 'notes', name: 'Notes', icon: FileType, firstParty: false, opens: ['md'] };
const names = (o: OpenersOf<App>): string[] => o.apps.map((a: App): string => a.name);

describe('which apps open a file', () => {
  it('is none for an extension no app claims, so the file downloads, saying why', () => {
    const none: OpenersOf<App> = openersFor('photo.xyz', [DOCS, PAD], null);
    expect(none.apps).toEqual([]);
    expect(activationOf(none)).toEqual({ kind: 'download', notice: 'Downloading instead — no app here opens .xyz files' });
  });

  it('is the one app that claims it, which activation opens', () => {
    expect(activationOf(openersFor('plan.docx', [DOCS, PAD], null))).toEqual({ kind: 'open', app: DOCS });
  });

  it('puts a first-party app before others when several claim it', () => {
    expect(names(openersFor('readme.md', [PAD, NOTES, DOCS], null))).toEqual(['Citadel Docs', 'Pad', 'Notes']);
  });

  it('puts the last choice first, before a first-party app, while that app still opens it', () => {
    expect(names(openersFor('readme.md', [PAD, NOTES, DOCS], 'notes'))).toEqual(['Notes', 'Citadel Docs', 'Pad']);
    // A choice for an app that does not open this file changes nothing.
    expect(names(openersFor('plan.docx', [PAD, DOCS], 'pad'))).toEqual(['Citadel Docs']);
  });

  it('reads the extension case-insensitively', () => {
    expect(names(openersFor('PLAN.DocX', [DOCS], null))).toEqual(['Citadel Docs']);
  });

  it('has none for a name without an extension or a dotfile, and says so', () => {
    expect(openersFor('README', [DOCS], null).apps).toEqual([]);
    expect(openersFor('.md', [DOCS], null).apps).toEqual([]);
    expect(activationOf(openersFor('README', [DOCS], null))).toEqual({ kind: 'download', notice: 'Downloading instead — no app here opens files without an extension' });
  });

  it('reads only the last part of a multi-dot name', () => {
    expect(openersFor('a.tar.gz', [DOCS, PAD], null)).toEqual({ extension: 'gz', apps: [PAD] });
    expect(openersFor('notes.md.txt', [DOCS, PAD], null).apps).toEqual([DOCS]);
  });

  it('offers only the apps it is given: one not available here (uninstalled) is never offered', () => {
    expect(names(openersFor('readme.md', [DOCS], null))).toEqual(['Citadel Docs']);
    expect(openersFor('plan.docx', [], null).apps).toEqual([]);
  });

  it('downloads, claiming nothing, a file whose bytes no app could read here', () => {
    expect(activationOf(null)).toEqual({ kind: 'download', notice: null });
  });
});

describe('a file menu', () => {
  it('always has Download where the file can be had, and Open only with an app', () => {
    expect(fileMenuModel(openersFor('photo.xyz', [DOCS], null), true)).toEqual({ open: null, openWith: [], download: true });
    expect(fileMenuModel(null, true)).toEqual({ open: null, openWith: [], download: true });
    expect(fileMenuModel(openersFor('plan.docx', [DOCS], null), true)).toEqual({ open: DOCS, openWith: [], download: true });
  });

  it('has Open with… only when several apps claim the file', () => {
    const several: FileMenuModelOf<App> = fileMenuModel(openersFor('readme.md', [PAD, DOCS], null), false);
    expect(several.open).toBe(DOCS);
    expect(several.openWith.map((a: App): string => a.name)).toEqual(['Citadel Docs', 'Pad']);
    expect(several.download).toBe(false);
  });

  it('labels Open with the app\'s name', () => expect(openLabel(DOCS)).toBe('Open in Citadel Docs'));
});

describe('the built-in openers', () => {
  it('are Citadel Docs alone, for exactly what its engine imports', () => {
    expect(BUILT_IN_OPENERS.map((a: FileOpener): string => a.name)).toEqual(['Citadel Docs']);
    expect(BUILT_IN_OPENERS[0].opens).toEqual(['docx', 'dotx', 'odt', 'md', 'txt']);
    expect(BUILT_IN_OPENERS[0].firstParty).toBe(true);
  });
});
