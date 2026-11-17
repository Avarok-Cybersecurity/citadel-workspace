/**
 * One event on a calendar. Own events carry the primary bar; inherited and up-pulled events the
 * muted bar and a "From <node>" caption; a cancelled event is struck through and says so; a busy
 * time reads "Busy". Colour is never the only signal (design §3.9).
 */
import { cn } from '@/lib/utils';
import { chipLabel, chipWords, type ChipWords } from '@/lib/calendar/chip-label';
import type { Chip } from '@/lib/calendar/placement';
import { ZoneBadge } from './ZoneBadge';

export type ChipDensity = 'cell' | 'column' | 'row';

interface EventChipProps {
  chip: Chip;
  displayZone: string;
  nodeName: (id: string) => string;
  density: ChipDensity;
  /** Inside a grid the grid is the tab stop, so its chips are reached through the day instead. */
  inGrid: boolean;
  onOpen: (chip: Chip) => void;
  className?: string;
  style?: React.CSSProperties;
}

const TONE: Record<Chip['origin'], string> = {
  own: 'border-primary bg-primary/10',
  inherited: 'border-muted-foreground bg-muted',
  up_pulled: 'border-muted-foreground bg-muted',
};

function Words({ words, density, zone }: { words: ChipWords; density: ChipDensity; zone: string }): JSX.Element {
  const title: JSX.Element = <span className={cn('truncate font-medium', words.cancelled && 'line-through')}>{words.title}</span>;
  return (
    <>
      <span className={cn('flex min-w-0 items-center gap-1', density === 'row' && 'w-28 shrink-0')}>
        <span className="shrink-0 tabular-nums text-muted-foreground">{words.time}</span>
        {density === 'row' && words.clock !== null && <span className="shrink-0 text-xs text-muted-foreground">{words.clock}</span>}
        {words.badge !== null && density !== 'cell' && <ZoneBadge label={words.badge} zone={zone} />}
      </span>
      <span className={cn('flex min-w-0 gap-1', density === 'column' ? 'flex-col' : 'items-center')}>
        {title}
        {words.cancelled && <span className="shrink-0 text-destructive-emphasis">Cancelled</span>}
        {words.from !== null && <span className="truncate text-muted-foreground">{words.from}</span>}
      </span>
    </>
  );
}

export function EventChip({ chip, displayZone, nodeName, density, inGrid, onOpen, className, style }: EventChipProps): JSX.Element {
  const words: ChipWords = chipWords(chip, displayZone, nodeName);
  return (
    <button
      type="button"
      tabIndex={inGrid ? -1 : 0}
      aria-label={chipLabel(chip, displayZone, nodeName)}
      data-testid="calendar-event-chip"
      data-origin={chip.origin}
      onClick={(e: React.MouseEvent): void => {
        e.stopPropagation();
        onOpen(chip);
      }}
      style={style}
      className={cn(
        'flex w-full min-w-0 overflow-hidden rounded-sm border-l-4 text-left text-xs text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        density === 'cell' && 'items-center gap-1 px-1 py-0.5',
        density === 'column' && 'flex-col items-start px-1.5 py-1',
        density === 'row' && 'min-h-[44px] items-center gap-3 px-3 py-2 text-sm',
        TONE[chip.origin],
        className,
      )}
    >
      <Words words={words} density={density} zone={chip.zone} />
    </button>
  );
}
