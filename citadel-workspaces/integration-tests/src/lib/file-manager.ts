/**
 * The file manager, as the specs drive it: by role, name and test id.
 *
 * One place for the selectors, so a redesign updates one module rather than four
 * specs that each carried their own guess at the toolbar (icon class names, a
 * `.flex.items-center.gap-1` fallback, a tree that no longer exists).
 *
 * Whose storage is open comes from the address: `section=files` alone is Server
 * Storage, `peer_id=<cid>` is that peer's shared storage. Folder navigation is a
 * double-click (a single click selects and opens the inspector).
 */
import type { Locator, Page } from 'playwright';
import { isVisibleWithin } from './utils.js';

/** One item in the open folder, list row or grid tile. */
export function fmItem(page: Page, name: string): Locator {
  return page.getByTestId(`vfs-item-${name}`);
}

/** The Server segment of the storage switch. */
export function serverStorageButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Server Storage', exact: true });
}

/** The folder path the address bar shows. */
export function folderPath(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Folder path' });
}

/** Open the file manager on `search` (e.g. `section=files&peer_id=42`) without a reload. */
export async function openFileManagerAt(page: Page, search: string): Promise<void> {
  await page.evaluate((query: string): void => {
    window.history.pushState({}, '', `/workspace?${query}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, search);
}

/** Open the file manager from the sidebar, which lands on Server Storage at the top level. */
export async function openFileManagerFromSidebar(page: Page): Promise<boolean> {
  const button: Locator = page.getByTestId('file-manager-button');
  if (!(await isVisibleWithin(button, 10_000))) return false;
  await button.click();
  return isVisibleWithin(page.getByRole('group', { name: 'Storage' }), 10_000);
}

/** Switch to `username`'s shared storage through the P2P segment's peer menu. */
export async function openPeerStorage(page: Page, username: string): Promise<boolean> {
  const p2p: Locator = page.getByTestId('storage-p2p');
  if (!(await isVisibleWithin(p2p, 10_000))) return false;
  await p2p.click();
  const peer: Locator = page.getByTestId(`storage-peer-${username}`);
  if (!(await isVisibleWithin(peer, 10_000))) return false;
  await peer.click();
  // A peer's tree arrives over P2P; the address bar is drawn once it has.
  return isVisibleWithin(page.getByRole('button', { name: 'Sync with peer' }), 30_000);
}

const NEW_MENU_ENTRIES: Readonly<Record<'folder' | 'upload', string>> = { folder: 'vfs-new-folder', upload: 'vfs-new-upload' };

/** Pick an entry from the New menu: New folder or Upload files. */
export async function chooseFromNewMenu(page: Page, entry: 'folder' | 'upload'): Promise<boolean> {
  const trigger: Locator = page.getByTestId('vfs-new');
  if (!(await isVisibleWithin(trigger, 5_000))) return false;
  await trigger.click();
  const item: Locator = page.getByTestId(NEW_MENU_ENTRIES[entry]);
  if (!(await isVisibleWithin(item, 3_000))) return false;
  await item.click();
  return true;
}

/** New folder through the New menu and its name dialog; true once the item is in the folder. */
export async function createFolder(page: Page, name: string): Promise<boolean> {
  if (!(await chooseFromNewMenu(page, 'folder'))) return false;
  const input: Locator = page.locator('#prompt-dialog-input');
  if (!(await isVisibleWithin(input, 5_000))) return false;
  await input.fill(name);
  await page.getByTestId('prompt-dialog-confirm').click();
  return isVisibleWithin(fmItem(page, name), 10_000);
}

/** Open a folder in the list; true once the address bar names it as the current folder. */
export async function openFolderItem(page: Page, name: string): Promise<boolean> {
  const item: Locator = fmItem(page, name);
  if (!(await isVisibleWithin(item, 5_000))) return false;
  await item.dblclick();
  return isVisibleWithin(folderPath(page).locator('[aria-current="page"]', { hasText: name }), 5_000);
}

/**
 * Back to the top level by the Root crumb. Up is enabled only below the top level,
 * so it says there was somewhere to come back from; Root becoming the current crumb
 * says we arrived. Both are waited for as states, not sampled.
 */
export async function goToRoot(page: Page): Promise<{ wasDeeper: boolean; atRoot: boolean }> {
  const wasDeeper: boolean = await isVisibleWithin(page.locator('[data-testid="vfs-up"]:enabled'), 1_000);
  await page.getByTestId('vfs-breadcrumb-root').click();
  const atRoot: boolean = await isVisibleWithin(page.locator('[data-testid="vfs-breadcrumb-root"][aria-current="page"]'), 3_000);
  return { wasDeeper, atRoot };
}

/** Refresh, or "Sync with peer" in shared storage: the same address-bar button. */
export async function refreshFiles(page: Page): Promise<boolean> {
  const button: Locator = page.getByTestId('vfs-refresh');
  if (!(await isVisibleWithin(button, 5_000))) return false;
  await button.click();
  return true;
}

/** Right-click an item; the open menu, or null when the item is not shown. */
export async function openItemMenu(page: Page, name: string): Promise<Locator | null> {
  const item: Locator = fmItem(page, name);
  if (!(await isVisibleWithin(item, 5_000))) return null;
  await item.click({ button: 'right' });
  const menu: Locator = page.getByRole('menu');
  return (await isVisibleWithin(menu, 3_000)) ? menu : null;
}

/** Delete an item through its menu and the in-app confirm; true once the confirm is clicked. */
export async function deleteItem(page: Page, name: string): Promise<boolean> {
  const menu: Locator | null = await openItemMenu(page, name);
  if (menu === null) return false;
  await menu.getByTestId('vfs-delete').click();
  const confirm: Locator = page.getByTestId('confirm-dialog-confirm');
  if (!(await isVisibleWithin(confirm, 5_000))) return false;
  await confirm.click();
  return true;
}

/**
 * Before any peer registration the P2P side offers nobody: its menu says so in
 * words. The menu is closed again, so the caller's page is as it was.
 */
export async function peerMenuOffersNobody(page: Page): Promise<boolean> {
  const p2p: Locator = page.getByTestId('storage-p2p');
  if (!(await isVisibleWithin(p2p, 10_000))) return false;
  await p2p.click();
  const nobody: boolean = await isVisibleWithin(page.getByRole('menuitem', { name: /^No peers yet\./ }), 15_000);
  await page.keyboard.press('Escape');
  return nobody;
}
