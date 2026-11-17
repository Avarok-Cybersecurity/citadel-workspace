/**
 * At boot, an app link and a secure link are each kept for after sign-in and their keys taken out
 * of the address, the path and hash left alone. An app link's `server` is its own, not a secure
 * link's. Control: an address with neither is not rewritten.
 */
import { describe, expect, it } from 'vitest';
import { captureBootLinks } from '../boot-links';
import { peekAppLink, takeAppLink } from '@/lib/citadel-apps/app-link';
import { peekPendingRedirect, takePendingRedirect } from '@/lib/share/pending-redirect';
import type { HandoffStorage } from '@/lib/chat/draft-handoff';

function memoryStorage(): HandoffStorage {
  const data: Map<string, string> = new Map();
  return { getItem: (k: string): string | null => data.get(k) ?? null, setItem: (k: string, v: string): void => { data.set(k, v); }, removeItem: (k: string): void => { data.delete(k); } };
}

function boot(pathname: string, search: string, hash: string = ''): { storage: HandoffStorage; urls: string[] } {
  const storage: HandoffStorage = memoryStorage();
  const urls: string[] = [];
  captureBootLinks({ pathname, search, hash }, storage, (u: string) => { urls.push(u); });
  return { storage, urls };
}

describe('links kept at boot', () => {
  it('an app link with its own server is kept as an app link', () => {
    const { storage, urls } = boot('/workspace', '?app=com.acme.kanban&server=acme.work.avarok.net', '#x');
    expect(urls.at(-1)).toBe('/workspace#x');
    expect(peekPendingRedirect(storage)).toBeNull();
    expect(takeAppLink(storage)).toEqual({ appId: 'com.acme.kanban', nodeId: null, version: null, server: 'acme.work.avarok.net' });
    expect(peekAppLink(storage)).toBeNull();
  });

  it('a secure link is kept as one, and no app link is invented', () => {
    const token: string = 'a'.repeat(43);
    const { storage, urls } = boot('/', `?redirect=${token}&server=acme.work.avarok.net`);
    expect(urls.at(-1)).toBe('/');
    expect(takePendingRedirect(storage)).toEqual({ token, server: 'acme.work.avarok.net' });
    expect(peekAppLink(storage)).toBeNull();
  });

  it('control: an address with neither is left as it is', () => {
    expect(boot('/workspace', '?tab=files').urls).toEqual([]);
  });
});
