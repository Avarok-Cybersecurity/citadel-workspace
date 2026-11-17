import type { PortalTab } from './billing-portal';

/**
 * A new, empty browser tab for the billing portal, or null when the browser
 * refused to open one (a popup blocker).
 *
 * Opened empty and pointed at the portal later, because the portal address
 * arrives after a request and a tab opened then is no longer the user's click.
 * `opener` is cut before anything loads, so the portal page cannot reach back
 * into this one.
 */
export function openBrowserPortalTab(): PortalTab | null {
  const tab: Window | null = window.open('about:blank', '_blank');
  if (tab === null) return null;
  tab.opener = null;
  return {
    navigate(url: string): void { tab.location.replace(url); },
    close(): void { tab.close(); },
  };
}
