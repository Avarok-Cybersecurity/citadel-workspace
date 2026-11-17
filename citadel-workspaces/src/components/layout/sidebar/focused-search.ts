/**
 * The hierarchy filter, as a flat list of matches that carry their path.
 *
 * The old filter cut the tree down to the matches and their ancestors, which
 * kept the shape and lost the answer to "which Floor 1?" once two branches had
 * one. Each result here names its own path, so two matches with the same name
 * read as two different places.
 *
 * Folded once per query -- see fold-for-search.ts.
 */
import { searchMatcher } from '@/lib/fold-for-search';
import type { DomainNode } from './tree-node-types';
import { ancestorsOf } from './focused-view';

export interface SearchResult {
  node: DomainNode;
  /** Names from the workspace down to the match's parent. */
  path: string[];
}

/** More than this many results show a "Show all" control rather than a page of rows. */
export const SEARCH_RESULT_CAP: number = 12;

export function searchResults(nodes: Readonly<Record<string, DomainNode>>, root: DomainNode, query: string): SearchResult[] {
  if (!query.trim()) return [];
  const matches: (haystack: string) => boolean = searchMatcher(query);
  const candidates: DomainNode[] = nodes[root.id] ? Object.values(nodes) : [root, ...Object.values(nodes)];
  return candidates
    .filter((node: DomainNode): boolean => matches(node.name))
    .map((node: DomainNode): SearchResult => ({
      node,
      path: ancestorsOf(nodes, node, root).map((a: DomainNode): string => a.name),
    }))
    .sort((a: SearchResult, b: SearchResult): number =>
      a.node.name.localeCompare(b.node.name) || a.path.join('\u0000').localeCompare(b.path.join('\u0000')));
}
