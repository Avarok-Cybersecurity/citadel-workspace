/**
 * Insert › Table: Word's grid. Pointing or moving with the arrow keys sizes the table
 * (columns × rows, as Word labels it); a click, Enter or Space inserts it. Cells are 44px
 * targets, so the grid is sized to fit a phone.
 */
import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Table } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { RibbonButton } from './RibbonButton';
import { useRibbon, type Ribbon } from './ribbon-context';

export const TABLE_GRID_ROWS: number = 7;
export const TABLE_GRID_COLS: number = 7;

interface Size {
  readonly rows: number;
  readonly cols: number;
}

const MOVES: Readonly<Record<string, Size>> = {
  ArrowRight: { rows: 0, cols: 1 }, ArrowLeft: { rows: 0, cols: -1 }, ArrowDown: { rows: 1, cols: 0 }, ArrowUp: { rows: -1, cols: 0 },
};

const clamp: (v: number, max: number) => number = (v: number, max: number): number => Math.max(1, Math.min(max, v));

function sizeLabel({ rows, cols }: Size): string {
  return `${cols} × ${rows} table`;
}

export function TablePicker(): JSX.Element {
  const { run }: Ribbon = useRibbon();
  const [open, setOpen] = useState<boolean>(false);
  const [size, setSize] = useState<Size>({ rows: 1, cols: 1 });
  const grid: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  const focusCell: (next: Size) => void = (next: Size): void => {
    setSize(next);
    grid.current?.querySelector<HTMLButtonElement>(`[data-cell="${next.rows}-${next.cols}"]`)?.focus();
  };
  const insert: (chosen: Size) => void = (chosen: Size): void => {
    setOpen(false);
    void run({ name: 'insertTable', rows: chosen.rows, cols: chosen.cols }, `insert a ${sizeLabel(chosen)}`);
  };
  const onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const move: Size | undefined = MOVES[e.key];
    if (move === undefined) return;
    e.preventDefault();
    focusCell({ rows: clamp(size.rows + move.rows, TABLE_GRID_ROWS), cols: clamp(size.cols + move.cols, TABLE_GRID_COLS) });
  };

  return (
    <Popover open={open} onOpenChange={(next: boolean): void => { setOpen(next); if (next) setSize({ rows: 1, cols: 1 }); }}>
      <PopoverTrigger asChild>
        <RibbonButton testId="ribbon-insert-table" label="Table" icon={Table} text="Table" />
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={16} className="w-auto p-2"
        onOpenAutoFocus={(e: Event): void => { e.preventDefault(); grid.current?.querySelector<HTMLButtonElement>('[data-cell="1-1"]')?.focus(); }}>
        <p aria-live="polite" data-testid="ribbon-table-size" className="mb-2 text-[14px] text-foreground">{sizeLabel(size)}</p>
        <div ref={grid} role="group" aria-label="Table size"
          className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${TABLE_GRID_COLS}, 44px)` }}>
          {Array.from({ length: TABLE_GRID_ROWS }, (_r: unknown, r: number): JSX.Element[] => Array.from({ length: TABLE_GRID_COLS }, (_c: unknown, c: number): JSX.Element => {
            const cell: Size = { rows: r + 1, cols: c + 1 };
            const lit: boolean = cell.rows <= size.rows && cell.cols <= size.cols;
            return (
              <button key={`${cell.rows}-${cell.cols}`} type="button" data-cell={`${cell.rows}-${cell.cols}`} data-testid={`ribbon-table-cell-${cell.rows}-${cell.cols}`}
                aria-label={`Insert a ${sizeLabel(cell)}`} tabIndex={cell.rows === size.rows && cell.cols === size.cols ? 0 : -1}
                onKeyDown={onKeyDown} onPointerEnter={(): void => setSize(cell)} onFocus={(): void => setSize(cell)} onClick={(): void => insert(cell)}
                className={cn('h-[44px] w-[44px] rounded-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', lit ? 'border-primary bg-primary/20' : 'border-border bg-background')} />
            );
          })).flat()}
        </div>
      </PopoverContent>
    </Popover>
  );
}
