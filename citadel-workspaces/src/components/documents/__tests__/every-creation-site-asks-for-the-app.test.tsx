/**
 * Every place a document can be made asks which Citadel App it opens in, through the one picker.
 *
 * Fixture coverage, in three directions, so a new place cannot skip the picker quietly:
 * - `SITES` is a Record over DOCUMENT_CREATION_SITES, so a site added to the registry without a
 *   fixture here does not compile;
 * - every module in src that writes a document (`.createDocument(`, app metadata encoded by
 *   hand, or a chat document's new id) must be some site's writer, so a new writer without a
 *   site fails here;
 * - each site's dialog is rendered: the picker lists every registry app, preselects none, and its
 *   Create stays disabled until an app is chosen; the write that site makes refuses an app the
 *   registry does not offer there.
 *
 * No mocks: each dialog's only output is its `onCreate`, a plain recorder here.
 */
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CITADEL_APPS, DOCUMENT_CREATION_SITES, type DocumentCreationSite } from '@/lib/citadel-apps/registry';
import { NewDocumentDialog } from '../NewDocumentDialog';
import { LiveDocumentModal } from '@/components/p2p/LiveDocumentModal';
import { APP_PICKER_LEGEND } from '../CitadelAppPicker';

const ROOT: string = process.cwd();
const SRC: string = join(ROOT, 'src');

interface SiteFixture {
  /** The module that makes the write at this site. */
  readonly writer: string;
  /** The module whose dialog the person makes the document through. */
  readonly dialog: string;
  /** Renders the dialog with `onCreate` as its only output. */
  readonly open: (onCreate: (input: { readonly app: string }) => Promise<void>) => void;
  /** Fills everything but the app. */
  readonly fillRest: () => Promise<void>;
  readonly createButton: string;
}

const SITES: Readonly<Record<DocumentCreationSite, SiteFixture>> = {
  workspaceTree: {
    writer: 'src/components/layout/sidebar/use-new-document.ts',
    dialog: 'src/components/documents/NewDocumentDialog.tsx',
    open: (onCreate) => { render(<NewDocumentDialog parentName="Floor 3" placement={{ kind: 'one', type: 'Room' }} onCreate={onCreate} onClose={vi.fn()} />); },
    fillRest: async () => { await userEvent.type(screen.getByTestId('new-document-name'), 'Plan'); },
    createButton: 'new-document-create',
  },
  chat: {
    writer: 'src/components/p2p/hooks/useP2PTabs.ts',
    dialog: 'src/components/p2p/LiveDocumentModal.tsx',
    open: (onCreate) => { render(<LiveDocumentModal isOpen onClose={vi.fn()} onCreateDocument={onCreate} />); },
    fillRest: async () => { await userEvent.type(screen.getByTestId('live-doc-title'), 'Plan'); },
    createButton: 'live-doc-create',
  },
};

/** Implementations the writers call, not places a person makes a document. */
const IMPLEMENTATIONS: ReadonlySet<string> = new Set<string>(['src/lib/workspace-service/document-operations.ts']);

const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string): string[] => {
    const path: string = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** A call (not the definition) of a way to make a document: a node, its app metadata, or a chat's new Citadel Docs id. */
const DOCUMENT_WRITE: RegExp = /\.createDocument\(|(?<!function )\bencodeNodeApp\(|(?<!function )\bnewChatDocumentId\(/;
const code = (file: string): string => withoutComments(readFileSync(join(ROOT, file), 'utf8'));

describe('every place a document can be made', () => {
  it('is a creation site with a fixture here, and its writer is one this test knows', () => {
    const writers: string[] = sourceFiles(SRC)
      .map((path: string): string => relative(ROOT, path))
      .filter((file: string): boolean => !IMPLEMENTATIONS.has(file) && DOCUMENT_WRITE.test(code(file)));
    const known: string[] = DOCUMENT_CREATION_SITES.map((site: DocumentCreationSite): string => SITES[site].writer);
    expect(writers.sort()).toEqual([...known].sort());
  });

  it.each(DOCUMENT_CREATION_SITES)('%s: renders the shared picker and checks the app against the registry before writing', (site: DocumentCreationSite) => {
    expect(code(SITES[site].dialog)).toMatch(/<CitadelAppPicker\s[^>]*site="([a-zA-Z]+)"/);
    expect(code(SITES[site].dialog).match(/<CitadelAppPicker\s[^>]*site="([a-zA-Z]+)"/)?.[1]).toBe(site);
    const guarded: boolean = [SITES[site].writer, ...IMPLEMENTATIONS].some((file: string): boolean => code(file).includes(`'${site}')`) && code(file).includes('creatableIn('));
    expect(guarded).toBe(true);
  });

  it.each(DOCUMENT_CREATION_SITES)('%s: lists every app, preselects none, and creates only once one is chosen', async (site: DocumentCreationSite) => {
    const fixture: SiteFixture = SITES[site];
    const made: string[] = [];
    fixture.open(async (input: { readonly app: string }): Promise<void> => { made.push(input.app); });
    const picker: HTMLElement = screen.getByRole('radiogroup', { name: APP_PICKER_LEGEND });
    const radios: HTMLElement[] = within(picker).getAllByRole('radio');
    expect(radios).toHaveLength(CITADEL_APPS.length);
    for (const app of CITADEL_APPS) expect(within(picker).getByRole('radio', { name: new RegExp(app.name) })).not.toBeChecked();
    await fixture.fillRest();
    expect(screen.getByTestId(fixture.createButton)).toBeDisabled();
    await userEvent.click(within(picker).getByRole('radio', { name: /Citadel Docs/ }));
    expect(screen.getByTestId(fixture.createButton)).toBeEnabled();
    await userEvent.click(screen.getByTestId(fixture.createButton));
    expect(made).toEqual(['docs']);
  });
});
