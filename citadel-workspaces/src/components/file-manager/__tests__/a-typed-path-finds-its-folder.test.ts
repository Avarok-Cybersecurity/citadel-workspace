/**
 * The address bar: what a typed path opens, the crumbs a path shows, the count
 * beside them, and where Back goes.
 */
import { describe, it, expect } from 'vitest';
import type { RevfsNode } from '@/types/revfs-types';
import { resolveTypedPath, crumbsOf, itemCountLabel } from '../address-bar-model';
import { visitFolder, goBack, type VisitedFolders } from '../visited-folders';

function dir(path: string, children: RevfsNode[] = []): RevfsNode {
  return { name: path === '/' ? '' : path.split('/').pop() ?? '', path, type: 'directory', children, createdAt: 1, updatedAt: 1 };
}
function file(path: string): RevfsNode {
  return { name: path.split('/').pop() ?? '', path, type: 'file', createdAt: 1, updatedAt: 1 };
}

const TREE: RevfsNode = dir('/', [
  dir('/Received Files', [dir('/Received Files/Archive'), file('/Received Files/a.pdf')]),
  dir('/Sent Files'),
  dir('/docs'),
  dir('/Docs'),
  file('/notes.md'),
]);

describe('typing a path', () => {
  it('opens a folder whatever its case', () => {
    expect(resolveTypedPath(TREE, '/received files/archive')).toEqual({ ok: true, path: '/Received Files/Archive' });
  });

  it('prefers the folder spelled exactly as typed when case alone tells two apart', () => {
    expect(resolveTypedPath(TREE, '/Docs')).toEqual({ ok: true, path: '/Docs' });
    expect(resolveTypedPath(TREE, '/docs')).toEqual({ ok: true, path: '/docs' });
  });

  it('forgives a missing leading slash, a trailing one and surrounding space', () => {
    expect(resolveTypedPath(TREE, '  Sent Files/ ')).toEqual({ ok: true, path: '/Sent Files' });
  });

  it('opens the top level for an empty or bare slash', () => {
    expect(resolveTypedPath(TREE, '')).toEqual({ ok: true, path: '/' });
    expect(resolveTypedPath(TREE, '/')).toEqual({ ok: true, path: '/' });
  });

  it('refuses a folder that is not there', () => {
    expect(resolveTypedPath(TREE, '/Received Files/Nope')).toEqual({ ok: false });
  });

  it('refuses a file: a path names a folder to open', () => {
    expect(resolveTypedPath(TREE, '/notes.md')).toEqual({ ok: false });
    expect(resolveTypedPath(TREE, '/notes.md/x')).toEqual({ ok: false });
  });
});

describe('the crumbs', () => {
  it('are the top level and then each folder on the way', () => {
    expect(crumbsOf('/Received Files/Archive')).toEqual([
      { name: 'Root', path: '/' },
      { name: 'Received Files', path: '/Received Files' },
      { name: 'Archive', path: '/Received Files/Archive' },
    ]);
  });

  it('are just the top level at the top level', () => {
    expect(crumbsOf('/')).toEqual([{ name: 'Root', path: '/' }]);
  });
});

describe('the count beside them', () => {
  it('names what the folder holds', () => {
    expect(itemCountLabel([dir('/a'), dir('/b')])).toBe('2 folders');
    expect(itemCountLabel([file('/a')])).toBe('1 file');
    expect(itemCountLabel([dir('/a'), file('/b'), file('/c')])).toBe('1 folder, 2 files');
    expect(itemCountLabel([])).toBe('Empty');
  });
});

describe('Back', () => {
  it('returns through the folders visited, most recent first', () => {
    let visited: VisitedFolders = [];
    visited = visitFolder(visited, '/', '/a');
    visited = visitFolder(visited, '/a', '/a/b');
    const first: { visited: VisitedFolders; to: string } | null = goBack(visited);
    expect(first?.to).toBe('/a');
    expect(goBack(first?.visited ?? [])?.to).toBe('/');
  });

  it('has nowhere to go before any folder was left', () => {
    expect(goBack([])).toBeNull();
  });

  it('does not record staying put', () => {
    expect(visitFolder([], '/a', '/a')).toEqual([]);
  });
});
