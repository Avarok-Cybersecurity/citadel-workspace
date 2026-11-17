/**
 * The address bar: Back and Up, the address field, the item count, and the
 * view's own controls -- sort by name or modified, list or grid, refresh.
 */
import { ArrowUpDown, ChevronLeft, ChevronUp, LayoutGrid, List, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { RevfsNode } from '@/types/revfs-types';
import { cn } from '@/lib/utils';
import { AddressField } from './AddressField';
import type { SortDirection, SortField } from './vfs-content-helpers';
import type { ContentView } from './VFSContentGrid';

export interface FileManagerAddressBarProps {
  tree: RevfsNode | null;
  path: string;
  onOpenFolder: (path: string) => void;
  back: (() => void) | null;
  up: (() => void) | null;
  countLabel: string | null;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortChange: (field: SortField, direction: SortDirection) => void;
  view: ContentView;
  onViewChange: (view: ContentView) => void;
  onRefresh: () => void;
  /** What Refresh does here: "Sync with peer" or "Refresh". */
  refreshLabel: string;
}

const SORT_LABELS: Readonly<Record<SortField, string>> = { name: 'Name', date: 'Modified' };
const ICON_BUTTON: string = 'h-[32px] w-[32px] shrink-0';

export function FileManagerAddressBar(props: FileManagerAddressBarProps): JSX.Element {
  const { tree, path, onOpenFolder, back, up, countLabel, sortField, sortDirection, onSortChange, view, onViewChange, onRefresh, refreshLabel } = props;
  const sortLabel: string = `Sort by ${SORT_LABELS[sortField]}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}`;
  const pick = (field: SortField): void => {
    // Choosing the order already in force flips its direction.
    onSortChange(field, field === sortField && sortDirection === 'asc' ? 'desc' : 'asc');
  };
  return (
    <div className="flex flex-wrap items-center gap-[8px] border-b border-border bg-card px-[16px] py-[8px]" data-testid="vfs-address-bar">
      <div className="flex min-w-0 flex-1 basis-full items-center gap-[8px] md:basis-0">
        <Button variant="outline" size="icon" className={ICON_BUTTON} onClick={back ?? undefined} disabled={back === null} aria-label="Back" data-testid="vfs-back">
          <ChevronLeft className="h-[16px] w-[16px]" aria-hidden="true" />
        </Button>
        <Button variant="outline" size="icon" className={ICON_BUTTON} onClick={up ?? undefined} disabled={up === null} aria-label="Up one folder" data-testid="vfs-up">
          <ChevronUp className="h-[16px] w-[16px]" aria-hidden="true" />
        </Button>
        <AddressField tree={tree} path={path} onOpenFolder={onOpenFolder} />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-[8px]">
        {countLabel !== null && <span className="whitespace-nowrap text-xs text-muted-foreground" data-testid="vfs-folder-count">{countLabel}</span>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-[32px] gap-[6px] px-[10px] text-sm" aria-label={sortLabel}>
              <ArrowUpDown className="h-[14px] w-[14px]" aria-hidden="true" />{SORT_LABELS[sortField]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.keys(SORT_LABELS) as SortField[]).map((field: SortField) => (
              <DropdownMenuItem key={field} onSelect={() => pick(field)} className={cn('cursor-pointer', field === sortField && 'text-primary-accent')}>
                {SORT_LABELS[field]}
                {field === sortField && (
                  <span className="ml-auto pl-[12px] text-xs">
                    <span aria-hidden="true">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    <span className="sr-only">{sortDirection === 'asc' ? ', ascending' : ', descending'}</span>
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="inline-flex gap-[4px] rounded-[6px] border border-border p-[2px]" role="group" aria-label="View">
          {([['grid', LayoutGrid, 'Grid view'], ['list', List, 'List view']] as const).map(([mode, Icon, label]) => (
            <button
              key={mode} type="button" onClick={() => onViewChange(mode)} aria-pressed={view === mode} aria-label={label}
              className={cn('grid h-[26px] w-[28px] place-items-center rounded-[4px]', view === mode ? 'bg-surface text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              <Icon className="h-[14px] w-[14px]" aria-hidden="true" />
            </button>
          ))}
        </div>
        <Button variant="outline" size="icon" className={ICON_BUTTON} onClick={onRefresh} aria-label={refreshLabel} data-testid="vfs-refresh">
          <RefreshCw className="h-[15px] w-[15px]" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
