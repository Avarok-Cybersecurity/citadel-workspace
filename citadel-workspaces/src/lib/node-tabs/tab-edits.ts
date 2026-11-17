/**
 * Edits to a node's app-tab list: pure, each answering the new list or why it cannot be made.
 * The page and chat tabs are not in the list, so no edit can move or remove them.
 */
import { MAX_APP_TABS } from './tab-keys';

export type TabEdit = { readonly ok: true; readonly appIds: readonly string[] } | { readonly ok: false; readonly why: string };

export function appendTab(appIds: readonly string[], appId: string): TabEdit {
  if (appIds.includes(appId)) return { ok: false, why: 'This app is already a tab here.' };
  if (appIds.length >= MAX_APP_TABS) return { ok: false, why: `A page can have at most ${MAX_APP_TABS} app tabs.` };
  return { ok: true, appIds: [...appIds, appId] };
}

export function removeTab(appIds: readonly string[], appId: string): TabEdit {
  if (!appIds.includes(appId)) return { ok: false, why: 'This app is not a tab here.' };
  return { ok: true, appIds: appIds.filter((id: string): boolean => id !== appId) };
}

/** Move `appId` one place left (-1) or right (+1) among the app tabs. */
export function moveTab(appIds: readonly string[], appId: string, step: -1 | 1): TabEdit {
  const from: number = appIds.indexOf(appId);
  const to: number = from + step;
  if (from < 0) return { ok: false, why: 'This app is not a tab here.' };
  if (to < 0 || to >= appIds.length) return { ok: false, why: 'This tab cannot move further that way.' };
  const next: string[] = [...appIds];
  [next[from], next[to]] = [next[to], next[from]];
  return { ok: true, appIds: next };
}
