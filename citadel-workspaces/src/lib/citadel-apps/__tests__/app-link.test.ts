/**
 * App links: the strict shape, the capture at boot that takes the keys out of the address, the
 * sign-in reload it survives, and the one take. And such a link in chat or a document is an
 * ordinary internal link: no new scheme.
 */
import { describe, expect, it, vi } from 'vitest';
import { appLinkSearch, appLinkUrl, peekAppLink, readAppLinkParams, takeAppLink, type AppLink } from '../app-link';
import { captureAppLink } from '../app-link-capture';
import { classifyDocumentLink } from '@/lib/document-links';
import type { HandoffStorage } from '@/lib/chat/draft-handoff';

function memoryStorage(): HandoffStorage & { data: Map<string, string> } {
  const data: Map<string, string> = new Map();
  return {
    data,
    getItem: (k: string): string | null => data.get(k) ?? null,
    setItem: (k: string, v: string): void => { data.set(k, v); },
    removeItem: (k: string): void => { data.delete(k); },
  };
}

const read = (search: string): AppLink | null => readAppLinkParams(new URLSearchParams(search));
const KANBAN: AppLink = { appId: 'com.acme.kanban', nodeId: null, version: null, server: null };

describe('the shape of an app link', () => {
  it('reads the app, and the optional page, version and server', () => {
    expect(read('app=com.acme.kanban')).toEqual(KANBAN);
    expect(read('app=com.acme.kanban&scope=node:n-1&v=1.2.0&server=acme.work.avarok.net'))
      .toEqual({ appId: 'com.acme.kanban', nodeId: 'n-1', version: '1.2.0', server: 'acme.work.avarok.net' });
  });

  it.each([
    ['no app', 'scope=node:n-1'],
    ['an id that is not one', 'app=Kanban'],
    ['an id with a path', 'app=com.acme/../x'],
    ['an unknown key', 'app=com.acme.kanban&nodeId=n-1'],
    ['a repeated key', 'app=com.acme.kanban&app=com.acme.lint'],
    ['a scope that is not a page', 'scope=workspace&app=com.acme.kanban'],
    ['an empty page', 'app=com.acme.kanban&scope=node:'],
    ['a page with a slash', 'app=com.acme.kanban&scope=node:a/b'],
    ['a version with a suffix', 'app=com.acme.kanban&v=1.2.0-rc.1'],
    ['a version with a leading zero', 'app=com.acme.kanban&v=01.2.0'],
    ['a server that is a URL', 'app=com.acme.kanban&server=https://evil.example/x'],
  ])('refuses %s', (_why: string, search: string) => {
    expect(read(search)).toBeNull();
  });

  it('control: each refused shape differs from an accepted one only in the part refused', () => {
    expect(read('app=com.acme.kanban&scope=node:n-1')).not.toBeNull();
    expect(read('app=com.acme.kanban&v=1.2.0')).not.toBeNull();
  });

  it('writes the link it reads', () => {
    const link: AppLink = { appId: 'com.acme.kanban', nodeId: 'n_1:x', version: '2.0.1', server: 'acme.work.avarok.net' };
    expect(read(appLinkSearch(link))).toEqual(link);
    expect(appLinkUrl('https://work.avarok.net', KANBAN)).toBe('https://work.avarok.net/workspace?app=com.acme.kanban');
  });
});

describe('capture before sign-in, taken once', () => {
  it('keeps the link, takes its keys out of the address and leaves the rest', () => {
    const storage: ReturnType<typeof memoryStorage> = memoryStorage();
    const replace: ReturnType<typeof vi.fn> = vi.fn();
    captureAppLink('/workspace', '?app=com.acme.kanban&v=1.0.0&utm=x', storage, replace);
    expect(replace).toHaveBeenCalledWith('utm=x');
    // Kept whole, so the strict reading at the take refuses the unknown key and opens nothing.
    expect(takeAppLink(storage)).toBeNull();
    expect(storage.data.size).toBe(0);

    captureAppLink('/workspace', '?app=com.acme.kanban&v=1.0.0', storage, replace);
    expect(replace).toHaveBeenLastCalledWith('');
    expect(peekAppLink(storage)).toEqual({ ...KANBAN, version: '1.0.0' });
    expect(takeAppLink(storage)).toEqual({ ...KANBAN, version: '1.0.0' });
    expect(takeAppLink(storage)).toBeNull();
  });

  it('ignores other pages and addresses without an app', () => {
    const replace: ReturnType<typeof vi.fn> = vi.fn();
    const storage: ReturnType<typeof memoryStorage> = memoryStorage();
    captureAppLink('/', '?app=com.acme.kanban', storage, replace);
    captureAppLink('/workspace', '?nodeId=n-1', storage, replace);
    expect(replace).not.toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
  });

  it('survives the sign-in reload: a fresh load of the module takes what storage kept', async () => {
    const storage: ReturnType<typeof memoryStorage> = memoryStorage();
    captureAppLink('/workspace', '?app=com.acme.kanban', storage, () => {});
    vi.resetModules();
    // A reload re-runs both halves: neither may hold the link in memory across it.
    const reloaded: typeof import('../app-link') = await import('../app-link');
    expect(reloaded.takeAppLink(storage)).toEqual(KANBAN);
    expect(reloaded.takeAppLink(storage)).toBeNull();
  });

  it('a malformed link is dropped from the address and opens nothing', () => {
    const replace: ReturnType<typeof vi.fn> = vi.fn();
    const storage: ReturnType<typeof memoryStorage> = memoryStorage();
    captureAppLink('/workspace', '?app=Not%20An%20Id', storage, replace);
    expect(replace).toHaveBeenCalledWith('');
    expect(takeAppLink(storage)).toBeNull();
  });

  it('a tampered stored link is not opened', () => {
    const storage: ReturnType<typeof memoryStorage> = memoryStorage();
    captureAppLink('/workspace', '?app=com.acme.kanban', storage, () => {});
    storage.data.set([...storage.data.keys()][0], 'app=com.acme.kanban&evil=1');
    expect(takeAppLink(storage)).toBeNull();
  });

  it('without storage, the link is held for this load only', () => {
    captureAppLink('/workspace', '?app=com.acme.kanban', null, () => {});
    expect(takeAppLink(null)).toEqual(KANBAN);
    expect(takeAppLink(null)).toBeNull();
  });
});

describe('in chat and documents', () => {
  it('an app link is an internal link, routed in the app', () => {
    const here: string = 'https://work.avarok.net/workspace?nodeId=n-1';
    expect(classifyDocumentLink(appLinkUrl('https://work.avarok.net', KANBAN), here))
      .toEqual({ kind: 'internal', to: '/workspace?app=com.acme.kanban' });
    expect(classifyDocumentLink('/workspace?app=com.acme.kanban&scope=node%3An-1', here))
      .toEqual({ kind: 'internal', to: '/workspace?app=com.acme.kanban&scope=node%3An-1' });
  });

  it('control: the same link on another origin is external', () => {
    expect(classifyDocumentLink(appLinkUrl('https://evil.example', KANBAN), 'https://work.avarok.net/workspace').kind).toBe('external');
  });
});
