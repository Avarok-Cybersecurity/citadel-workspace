/**
 * A secure link opened at `/?redirect=&server=` is kept across sign-in: captured at boot and
 * taken out of the address, still there after a reload, opened once, and never anything but a
 * well-formed token and server. No doubles: the storage is a Map behind the Storage methods.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingRedirect, RedirectStorage } from '../pending-redirect';

type PendingModule = typeof import('../pending-redirect');
type MapStorage = RedirectStorage & { map: Map<string, string> };

const TOKEN: string = 'A'.repeat(21) + '_-' + 'z9'.repeat(10);

function mapStorage(): MapStorage {
  const map: Map<string, string> = new Map();
  return {
    map,
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => { map.set(k, v); },
    removeItem: (k: string): void => { map.delete(k); },
  };
}

/** A fresh copy of the module: what a page reload gives. */
async function freshModule(): Promise<PendingModule> {
  vi.resetModules();
  return import('../pending-redirect');
}

describe('the pending secure link', () => {
  beforeEach(() => { vi.resetModules(); });

  it('is captured from the address, and its two keys are taken out of it', async () => {
    const m: PendingModule = await freshModule();
    const storage: MapStorage = mapStorage();
    const replaced: string[] = [];
    const pending: PendingRedirect | null = m.capturePendingRedirect(`?redirect=${TOKEN}&server=work.example.com`, storage, (s: string) => replaced.push(s));
    expect(pending).toEqual({ token: TOKEN, server: 'work.example.com' });
    expect(replaced).toEqual(['']);
  });

  it('survives a reload: a new copy of the module reads it back from storage', async () => {
    const storage: MapStorage = mapStorage();
    (await freshModule()).capturePendingRedirect(`?redirect=${TOKEN}&server=work.example.com:12349`, storage, () => {});
    const afterReload: PendingModule = await freshModule();
    expect(afterReload.peekPendingRedirect(storage)).toEqual({ token: TOKEN, server: 'work.example.com:12349' });
  });

  it('is opened once: take removes it, and a second take finds nothing', async () => {
    const m: PendingModule = await freshModule();
    const storage: MapStorage = mapStorage();
    m.capturePendingRedirect(`?redirect=${TOKEN}&server=work.example.com`, storage, () => {});
    expect(m.takePendingRedirect(storage)?.token).toBe(TOKEN);
    expect(m.takePendingRedirect(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('is held in memory for this load when storage refuses', async () => {
    const m: PendingModule = await freshModule();
    const refusing: RedirectStorage = {
      getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); },
    };
    m.capturePendingRedirect(`?redirect=${TOKEN}&server=work.example.com`, refusing, () => {});
    expect(m.takePendingRedirect(refusing)?.token).toBe(TOKEN);
    expect(m.takePendingRedirect(refusing)).toBeNull();
  });

  it('leaves the other keys of an address alone, and keeps nothing for a malformed link', async () => {
    const m: PendingModule = await freshModule();
    const storage: MapStorage = mapStorage();
    const replaced: string[] = [];
    expect(m.capturePendingRedirect(`?redirect=short&server=x.example.com&account=bob`, storage, (s: string) => replaced.push(s))).toBeNull();
    expect(replaced).toEqual(['account=bob']);
    expect(storage.map.size).toBe(0);
  });

  it('does nothing to an address without a redirect', async () => {
    const m: PendingModule = await freshModule();
    const replace: (search: string) => void = vi.fn<(search: string) => void>();
    expect(m.capturePendingRedirect('?account=bob&server=x.example.com', mapStorage(), replace)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ['a short token', `redirect=abc&server=x.example.com`],
    ['a token with a slash', `redirect=${'a'.repeat(42)}/&server=x.example.com`],
    ['no server', `redirect=${TOKEN}`],
    ['a URL as the server', `redirect=${TOKEN}&server=https://evil.example/`],
    ['two redirects', `redirect=${TOKEN}&redirect=${TOKEN}&server=x.example.com`],
    ['an extra key', `redirect=${TOKEN}&server=x.example.com&next=/`],
  ])('refuses %s', async (_name: string, query: string) => {
    const m: PendingModule = await freshModule();
    expect(m.readRedirectParams(new URLSearchParams(query))).toBeNull();
  });

  it('builds the link it reads: only the token and the server, nothing about the target', async () => {
    const m: PendingModule = await freshModule();
    const url: URL = new URL(m.secureLinkUrl('https://app.example', TOKEN, 'work.example.com'));
    expect(url.origin).toBe('https://app.example');
    expect(url.pathname).toBe('/');
    expect(m.readRedirectParams(url.searchParams)).toEqual({ token: TOKEN, server: 'work.example.com' });
  });
});
