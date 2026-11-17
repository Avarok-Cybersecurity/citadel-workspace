/**
 * What a secure link may open: the server's own rule (kernel/secure_links/target.rs), mirrored.
 * Checked before a link is made and again before a resolved one is navigated to, so an open
 * redirect is impossible even if the server ever answered with something else. No imports, so
 * the landing page can carry it.
 */
export type ShareKind = 'file' | 'folder' | 'node' | 'peer-chat' | 'group-chat' | 'directory';

export const DIRECTORY_PATH: '/directory' = '/directory';
export const GROUPS_PATH: '/groups/' = '/groups/';

/** The longest target the server accepts, in bytes. */
export const MAX_TARGET_BYTES: number = 2048;
const ROUTES: readonly string[] = ['/workspace', '/messages', DIRECTORY_PATH];
const PRINTABLE_ASCII: RegExp = /^[\x21-\x7e]+$/;
const GROUP_ID: RegExp = /^[A-Za-z0-9\-_.%]+$/;

function pathOf(target: string): string {
  const end: number = target.search(/[?#]/);
  return end === -1 ? target : target.slice(0, end);
}

function isGroupRoute(path: string): boolean {
  if (!path.startsWith(GROUPS_PATH)) return false;
  const id: string = path.slice(GROUPS_PATH.length);
  return GROUP_ID.test(id) && id !== '.' && id !== '..';
}

/** At most one `nodeId`, and a non-empty one: as the server reads the query. */
function nodeIdsAcceptable(target: string): boolean {
  const start: number = target.indexOf('?');
  if (start === -1) return true;
  const query: string = target.slice(start + 1).split('#')[0];
  const ids: string[] = query.split('&').filter((pair: string) => pair.startsWith('nodeId=')).map((pair: string) => pair.slice('nodeId='.length));
  if (ids.length > 1) return false;
  if (ids.length === 0) return true;
  try {
    return decodeURIComponent(ids[0].replace(/\+/g, ' ')) !== '';
  } catch {
    return false;
  }
}

/**
 * Whether `target` is a path this app may be sent to: printable ASCII, no backslash, rooted,
 * not protocol-relative, one of the app's routes. Anything else -- `javascript:`, `//host`,
 * another origin -- is refused.
 */
export function validateShareTarget(target: string): boolean {
  if (target.length === 0 || target.length > MAX_TARGET_BYTES) return false;
  if (!PRINTABLE_ASCII.test(target) || target.includes('\\')) return false;
  const path: string = pathOf(target);
  if (path.startsWith('//') || !path.startsWith('/')) return false;
  if (!ROUTES.includes(path) && !isGroupRoute(path)) return false;
  return nodeIdsAcceptable(target);
}

/** What kind of thing a stored link opens, for the Security list. */
export function kindOfTarget(target: string): ShareKind | null {
  if (!validateShareTarget(target)) return null;
  const path: string = pathOf(target);
  if (path === DIRECTORY_PATH) return 'directory';
  if (isGroupRoute(path)) return 'group-chat';
  if (path !== '/workspace') return null;
  const params: URLSearchParams = new URLSearchParams(target.slice(path.length));
  if (params.get('showP2P') === 'true') return 'peer-chat';
  if (params.has('section')) return params.has('item') ? 'file' : 'folder';
  return params.has('nodeId') ? 'node' : null;
}

export const SHARE_KIND_NAMES: Record<ShareKind, string> = {
  file: 'File', folder: 'Folder', node: 'Page', 'peer-chat': 'Chat', 'group-chat': 'Group chat', directory: 'Directory',
};
