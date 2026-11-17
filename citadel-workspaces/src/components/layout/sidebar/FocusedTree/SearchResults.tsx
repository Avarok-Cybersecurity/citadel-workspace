/**
 * The filter's answer: a flat list, each match with the path it lives at,
 * truncated from the left so the nearest ancestors -- the ones that tell two
 * "Floor 1"s apart -- are the part that stays. Capped, with "Show all".
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { nodeIcon } from '@/lib/citadel-apps/node-icon';
import { SEARCH_RESULT_CAP, type SearchResult } from '../focused-search';
import { AnimatePresence } from './tree-motion';

interface SearchResultsProps {
  results: SearchResult[];
  isMobile: boolean;
  onSelect: (nodeId: string) => void;
}

export function SearchResults({ results, isMobile, onSelect }: SearchResultsProps): JSX.Element {
  const [showAll, setShowAll] = useState<boolean>(false);
  if (results.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground" data-testid="tree-search-empty">No matching nodes</p>;
  }
  const shown: SearchResult[] = showAll ? results : results.slice(0, SEARCH_RESULT_CAP);
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <ul aria-label="Matching spaces" className="flex flex-col gap-0.5" data-testid="tree-search-results">
        <AnimatePresence initial={false}>
          {shown.map(({ node, path }: SearchResult) => {
            const Icon: ReturnType<typeof nodeIcon> = nodeIcon(node);
            return (
              <motion.li key={node.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <button
                  type="button"
                  onClick={() => onSelect(node.id)}
                  data-testid={`tree-search-result-${node.id}`}
                  title={[...path, node.name].join(' › ')}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 text-left hover:bg-primary-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                    isMobile ? 'min-h-[44px]' : 'min-h-[34px]',
                  )}
                >
                  <Icon className="h-[14px] w-[14px] shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm text-foreground">{node.name}</span>
                    {path.length > 0 && (
                      // rtl so the overflow is clipped on the left; the path itself stays left-to-right.
                      <span className="truncate text-left text-xs text-muted-foreground [direction:rtl]">
                        <bdi dir="ltr">{path.join(' › ')}</bdi>
                      </span>
                    )}
                  </span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {!showAll && results.length > SEARCH_RESULT_CAP && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          data-testid="tree-search-show-all"
          className="tap-target mt-1 w-full rounded-md px-2 text-left text-xs text-primary-accent hover:bg-primary-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          Show all {results.length}
        </button>
      )}
    </div>
  );
}
