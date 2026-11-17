/**
 * The consent screen's sentence for who an install reaches, with the people count when it is
 * known: "Everyone on “Engineering” and the 12 pages below it: 42 people".
 */
import type { InstallScope } from 'citadel-workspace-client-ts';

export interface Reach {
  people: number | null;
  pagesBelow: number | null;
}

const people = (n: number | null): string => (n === null ? '' : `: ${n} ${n === 1 ? 'person' : 'people'}`);

function names(list: readonly string[]): string {
  if (list.length <= 3) return list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`;
}

export function scopeSentence(scope: InstallScope, reach: Reach, nodeName: (id: string) => string | null): string {
  const page = (id: string): string => { const n: string | null = nodeName(id); return n === null ? 'this page' : `“${n}”`; };
  if (scope === 'Workspace') return `Everyone in this workspace${people(reach.people)}`;
  if ('SelfOnly' in scope) return 'Just you';
  if ('Users' in scope) return `${names(scope.Users)}${people(scope.Users.length)}`;
  if ('Node' in scope) return `Everyone who can open ${page(scope.Node)}${people(reach.people)}`;
  const below: string = reach.pagesBelow === null ? 'the pages below it' : `the ${reach.pagesBelow} ${reach.pagesBelow === 1 ? 'page' : 'pages'} below it`;
  return `Everyone on ${page(scope.NodeTree)} and ${below}${people(reach.people)}`;
}
