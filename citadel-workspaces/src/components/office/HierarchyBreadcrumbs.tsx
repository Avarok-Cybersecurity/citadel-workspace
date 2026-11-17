/**
 * Where you are in the hierarchy, and a way back up it: Workspace › … › here.
 *
 * Ancestors are buttons that open that level the way the sidebar does
 * (`onSelect` is use-select-node's select); the current level is the page's
 * heading, plain text marked `aria-current`. Below `md` everything between the
 * first ancestor and here folds into "…", so a deep path still fits a phone's
 * header beside its actions, and each name truncates rather than pushing them off.
 * Gaps and targets are in px: the root font is 14px, so rem sizes shrink.
 *
 * Names come from the path (lib/domain-path.ts), which takes them from the live
 * tree; nothing here knows what any level is called.
 */
import { ChevronRight } from 'lucide-react';
import type { DomainLevel } from '@/lib/domain-path';

interface HierarchyBreadcrumbsProps {
  /** From the workspace down to the current level, inclusive. */
  path: readonly DomainLevel[];
  /** The current level's name as the page shows it. */
  current: string;
  onSelect: (levelId: string) => void;
}

function Separator(): JSX.Element {
  return <ChevronRight className="h-[14px] w-[14px] shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function HierarchyBreadcrumbs({ path, current, onSelect }: HierarchyBreadcrumbsProps): JSX.Element {
  const ancestors: readonly DomainLevel[] = path.slice(0, -1);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1" data-testid="hierarchy-breadcrumbs">
      <ol className="flex min-w-0 items-center gap-[6px]">
        {/* An ancestor shrinks to no less than its button's 28px, the 6px gap and the 14px chevron. */}
        {ancestors.map((level: DomainLevel, index: number) => (
          <li key={level.id} className={`${index === 0 ? 'flex' : 'hidden md:flex'} min-w-[48px] shrink items-center gap-[6px]`} data-testid="breadcrumb-ancestor">
            <button
              type="button"
              onClick={(): void => onSelect(level.id)}
              title={[level.kind, level.name].filter(Boolean).join(' ')}
              className="min-h-[28px] min-w-[28px] max-w-[180px] truncate rounded px-1 text-sm text-muted-foreground transition-colors hover:text-primary-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {level.name}
            </button>
            <Separator />
          </li>
        ))}
        {ancestors.length > 1 && (
          <li className="flex shrink-0 items-center gap-[6px] text-sm text-muted-foreground md:hidden" aria-hidden="true" data-testid="breadcrumb-collapsed">
            …
            <Separator />
          </li>
        )}
        <li className="flex min-w-0 items-center">
          <h1 aria-current="page" className="truncate text-xl font-semibold text-foreground" data-testid="breadcrumb-current">{current}</h1>
        </li>
      </ol>
    </nav>
  );
}
