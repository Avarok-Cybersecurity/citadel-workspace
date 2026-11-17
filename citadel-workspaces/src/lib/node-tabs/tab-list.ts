/**
 * Which tabs a node's pane shows, derived and never stored.
 *
 * The page is the node itself and is always first; chat is second exactly when the node has chat
 * enabled. Neither is in any stored list. What is stored is the ordered list of APP tabs: the
 * node's own `app_tabs` when it has one (even empty), otherwise the workspace's
 * `default_app_tabs`. A node that never deviated therefore follows a later change to the default.
 *
 * Nothing here invents a default. A workspace with no `default_app_tabs` shows page and chat only,
 * and says so (`workspaceHasNoDefault`), so an administrator can choose one.
 */
import { isAppId } from '@/lib/citadel-apps/app-identity';
import { metadataDocument, type MetadataSource } from '@/lib/workspace-metadata/metadata-document';
import { APP_TABS_KEY, DEFAULT_APP_TABS_KEY, MAX_APP_TABS } from './tab-keys';

export type NodeTabKey = 'content' | 'chat' | `app:${string}`;

export type NodeTab =
  | { readonly key: 'content'; readonly kind: 'content' }
  | { readonly key: 'chat'; readonly kind: 'chat' }
  | { readonly key: `app:${string}`; readonly kind: 'app'; readonly appId: string };

/** A stored list as read: absent, a valid list, or something the rules refuse. */
export type StoredTabs =
  | { readonly kind: 'absent' }
  | { readonly kind: 'list'; readonly appIds: readonly string[] }
  | { readonly kind: 'refused'; readonly why: string };

export interface TabList {
  readonly tabs: readonly NodeTab[];
  /** Where the app tabs came from. */
  readonly source: 'node' | 'workspace' | 'none';
  /** The workspace has never been given default tabs. */
  readonly workspaceHasNoDefault: boolean;
  /** A stored list that could not be read, with why; its tabs are not shown. */
  readonly refused: string | null;
}

/** The app ids in `value`, or why they are refused: the server's `check_app_tabs` rules. */
export function readAppTabs(value: unknown): StoredTabs {
  if (value === undefined) return { kind: 'absent' };
  if (!Array.isArray(value) || !value.every((v: unknown): v is string => typeof v === 'string')) {
    return { kind: 'refused', why: 'not a list of app ids' };
  }
  if (value.length > MAX_APP_TABS) return { kind: 'refused', why: `more than ${MAX_APP_TABS} tabs` };
  const bad: string | undefined = value.find((id: string): boolean => !isAppId(id));
  if (bad !== undefined) return { kind: 'refused', why: `${JSON.stringify(bad)} is not an app id` };
  if (new Set(value).size !== value.length) return { kind: 'refused', why: 'an app is listed twice' };
  return { kind: 'list', appIds: value };
}

/** The stored list under `key` of a metadata document, however the bytes arrived. */
export function storedTabs(metadata: MetadataSource, key: typeof APP_TABS_KEY | typeof DEFAULT_APP_TABS_KEY): StoredTabs {
  return readAppTabs(metadataDocument(metadata)?.[key]);
}

export const appTabKey = (appId: string): `app:${string}` => `app:${appId}`;

export function deriveTabList(input: {
  readonly chatEnabled: boolean;
  readonly node: StoredTabs;
  readonly workspace: StoredTabs;
}): TabList {
  const fixed: NodeTab[] = [{ key: 'content', kind: 'content' }];
  if (input.chatEnabled) fixed.push({ key: 'chat', kind: 'chat' });
  const chosen: { stored: StoredTabs; source: 'node' | 'workspace' } =
    input.node.kind === 'absent' ? { stored: input.workspace, source: 'workspace' } : { stored: input.node, source: 'node' };
  const workspaceHasNoDefault: boolean = input.workspace.kind === 'absent';
  const { stored, source } = chosen;
  if (stored.kind !== 'list') {
    return { tabs: fixed, source: 'none', workspaceHasNoDefault, refused: stored.kind === 'refused' ? stored.why : null };
  }
  const apps: NodeTab[] = stored.appIds.map((appId: string): NodeTab => ({ key: appTabKey(appId), kind: 'app', appId }));
  return { tabs: [...fixed, ...apps], source, workspaceHasNoDefault, refused: null };
}

/** The app ids of a derived list, in order: what an edit starts from. */
export function appIdsOf(list: TabList): string[] {
  return list.tabs.flatMap((tab: NodeTab): string[] => (tab.kind === 'app' ? [tab.appId] : []));
}
