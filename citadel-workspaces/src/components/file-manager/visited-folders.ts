/**
 * The address bar's Back: the folders this view has left, newest last.
 *
 * Not the browser's history. That one also holds whatever page came before the
 * file manager, so a Back that called it could leave the file manager instead of
 * stepping out of a folder. Switching storage starts a fresh list: the folders
 * of another member's storage are not "back" from this one.
 */
export type VisitedFolders = readonly string[];

export function visitFolder(visited: VisitedFolders, from: string, to: string): VisitedFolders {
  return from === to ? visited : [...visited, from];
}

export function goBack(visited: VisitedFolders): { visited: VisitedFolders; to: string } | null {
  if (visited.length === 0) return null;
  return { visited: visited.slice(0, -1), to: visited[visited.length - 1] };
}
