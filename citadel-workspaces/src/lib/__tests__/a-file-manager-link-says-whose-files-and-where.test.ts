/**
 * The file manager's place lives in the URL: whose storage, which folder, which item.
 *
 * It lived in component state, and the peer was "the first registered one", so
 * the sidebar opened on whichever member happened to sort first and nobody could
 * send a link to a folder. These pin the mapping both ways, its defaults, and that
 * leaving the section leaves none of its keys behind.
 */
import { describe, it, expect } from 'vitest';
import {
  parseFileManagerLocation, fileManagerHref, fileManagerLink, resolveStorage,
  type FileManagerLocation, type FileManagerTarget, type StorageRef,
} from '@/lib/file-manager-location';
import { leaveSection } from '@/lib/workspace-navigation';

const parse = (query: string): FileManagerLocation => parseFileManagerLocation(new URLSearchParams(query));

describe('reading a file-manager address', () => {
  it('opens the server at the top level when the link names neither', () => {
    expect(parse('section=files')).toEqual({ storage: { kind: 'server' }, path: '/', item: null, via: null });
  });

  it('reads a peer by CID, as a bigint', () => {
    expect(parse('section=files&peer_id=42&path=/Docs').storage).toEqual({ kind: 'peer', cid: 42n });
  });

  it('keeps an unreadable peer id as unreadable, never as another peer or the server', () => {
    expect(parse('peer_id=bob').storage).toEqual({ kind: 'invalid', raw: 'bob' });
    expect(parse('peer_id=0').storage).toEqual({ kind: 'invalid', raw: '0' });
    expect(parse('peer_id=-3').storage).toEqual({ kind: 'invalid', raw: '-3' });
  });

  it('normalises the path it is given', () => {
    expect(parse('path=Docs//Q3/').path).toBe('/Docs/Q3');
    expect(parse('path=').path).toBe('/');
  });

  it('reads the item a link points at', () => {
    expect(parse('path=/Docs&item=report.pdf').item).toBe('report.pdf');
  });
});

describe('writing one', () => {
  it('round-trips through the address', () => {
    const at: FileManagerTarget = { storage: { kind: 'peer', cid: 9007199254740993n }, path: '/A b/c', item: 'x y.pdf', via: null };
    const href: string = fileManagerHref('', at);
    expect(parse(href.split('?')[1])).toEqual(at);
  });

  it('enters the section and leaves the workspace view behind', () => {
    const href: string = fileManagerHref('nodeId=n1&showP2P=true&channel=5&p2pUser=bob&join=abc', {
      storage: { kind: 'server' }, path: '/', item: null, via: null,
    });
    const params: URLSearchParams = new URLSearchParams(href.split('?')[1]);
    expect(params.get('section')).toBe('files');
    expect(params.get('peer_id')).toBe('server');
    expect(params.get('path')).toBe('/');
    for (const gone of ['nodeId', 'showP2P', 'channel', 'p2pUser', 'item']) expect(params.has(gone)).toBe(false);
    expect(params.get('join'), 'an unrelated parameter is not the file manager\'s to drop').toBe('abc');
  });

  it('writes the path normalised, as it reads it', () => {
    const href: string = fileManagerHref('', { storage: { kind: 'server' }, path: 'Docs//Q3/', item: null, via: null });
    expect(new URLSearchParams(href.split('?')[1]).get('path')).toBe('/Docs/Q3');
  });

  it('drops an item and a via that the new place does not name', () => {
    const href: string = fileManagerHref('section=files&peer_id=1&path=/a&item=b&via=7', {
      storage: { kind: 'server' }, path: '/', item: null, via: null,
    });
    expect(href).not.toMatch(/item=|via=/);
  });

  it('makes an absolute link a colleague can open', () => {
    const link: string = fileManagerLink('https://app.example', { storage: { kind: 'server' }, path: '/Q3', item: 'a.pdf', via: null });
    expect(link).toBe('https://app.example/workspace?section=files&peer_id=server&path=%2FQ3&item=a.pdf');
  });
});

describe('a peer link opened by that peer', () => {
  const sharedByAlice: FileManagerLocation = { storage: { kind: 'peer', cid: 20n }, path: '/', item: null, via: 10n };

  it('is the storage they share with whoever sent it', () => {
    // Alice (10) copied a link into the storage she shares with Bob (20). For Bob,
    // that same storage is the one he shares with Alice.
    expect(resolveStorage(sharedByAlice, 20n)).toEqual({ kind: 'peer', cid: 10n });
  });

  it('is unchanged for the person who made it', () => {
    expect(resolveStorage(sharedByAlice, 10n)).toEqual({ kind: 'peer', cid: 20n });
  });

  it('is unchanged when it names no sender', () => {
    const plain: FileManagerLocation = { ...sharedByAlice, via: null };
    const storage: StorageRef = resolveStorage(plain, 20n);
    expect(storage).toEqual({ kind: 'peer', cid: 20n });
  });
});

describe('leaving the file manager', () => {
  it('takes every one of its keys with it', () => {
    const params: URLSearchParams = new URLSearchParams('section=files&peer_id=1&path=/a&item=b&via=2&join=abc');
    const written: string[] = [...params.keys()].filter((key: string): boolean => key !== 'join');
    leaveSection(params);
    // Every key the address held, not the list that clears them: checked against
    // itself, a key left off the list would pass.
    for (const key of written) expect(params.has(key), key).toBe(false);
    expect(params.get('join')).toBe('abc');
  });
});
