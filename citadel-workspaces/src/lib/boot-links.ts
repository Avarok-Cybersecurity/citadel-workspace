/**
 * At boot, before any page reads the address: the links that must survive sign-in are kept and
 * their keys taken out of the address -- a secure link (`?redirect=&server=`, share/pending-redirect.ts)
 * and an app link (`/workspace?app=…`, citadel-apps/app-link.ts). Each sees the address the one
 * before it left.
 */
import type { HandoffStorage } from '@/lib/chat/draft-handoff';
import { capturePendingRedirect } from '@/lib/share/pending-redirect';
import { captureAppLink } from '@/lib/citadel-apps/app-link-capture';

interface BootAddress {
  pathname: string;
  search: string;
  hash: string;
}

export function captureBootLinks(address: BootAddress, storage: HandoffStorage | null, replaceUrl: (url: string) => void): void {
  let search: string = address.search;
  const replace = (next: string): void => {
    search = next === '' ? '' : `?${next}`;
    replaceUrl(`${address.pathname}${search}${address.hash}`);
  };
  capturePendingRedirect(search, storage, replace);
  captureAppLink(address.pathname, search, storage, replace);
}
