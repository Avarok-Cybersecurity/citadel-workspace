/**
 * What one event is, opened from its chip: in the page's flow above the grid, never a card over
 * the event it describes, with every fact in words (chip-label.ts). A booking its reader hosts or
 * booked can be cancelled from here; an event they may change (event-edit.ts) edited or cancelled.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { chipWords, type ChipWords } from '@/lib/calendar/chip-label';
import { formatTimeIn } from '@/lib/calendar/format';
import type { Chip, ChipSpan } from '@/lib/calendar/placement';
import { CancelBooking } from './CancelBooking';

interface EventDetailsProps {
  chip: Chip;
  displayZone: string;
  nodeName: (id: string) => string;
  onClose: () => void;
  /** Null unless the reader hosts or booked this booking and it is not cancelled. */
  onCancelBooking: ((reason: string | null) => Promise<string | null>) | null;
  /** Null unless the reader booked this booking and can reach its host to move it. */
  onReschedule: (() => void) | null;
  /** Both null unless the reader may change this event (`changeableBy`). */
  onEdit: (() => void) | null;
  onCancelEvent: ((reason: string | null) => Promise<string | null>) | null;
}

export function EventDetails({ chip, displayZone, nodeName, onClose, onCancelBooking, onReschedule, onEdit, onCancelEvent }: EventDetailsProps): JSX.Element {
  const heading: RefObject<HTMLHeadingElement> = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [chip.id]);
  const words: ChipWords = chipWords(chip, displayZone, nodeName);
  const span: ChipSpan = chip.span;
  const when: string = span.kind === 'all_day' ? 'All day' : `${words.time} to ${formatTimeIn(span.endMs, displayZone)} ${words.clock ?? ''}`;
  return (
    <section aria-label="Event details" data-testid="calendar-event-details" className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3">
      <div className="min-w-0 flex-1">
        <h3 ref={heading} tabIndex={-1} className={`break-words text-sm font-semibold text-foreground outline-none ${chip.cancelled ? 'line-through' : ''}`}>{words.title}</h3>
        <p className="text-sm text-muted-foreground">{when}{words.badge !== null ? ` (made in ${words.badge})` : ''}</p>
        {words.from !== null && <p className="text-sm text-muted-foreground">{words.from}</p>}
        {words.cancelled && <p className="text-sm font-medium text-foreground">Cancelled</p>}
        {onReschedule !== null && <Button type="button" variant="outline" className="mt-2 h-[44px]" onClick={onReschedule}>Reschedule</Button>}
        {onCancelBooking !== null && <CancelBooking key={chip.id} noun="booking" onCancel={onCancelBooking} />}
        {onEdit !== null && <Button type="button" variant="outline" className="mt-2 h-[44px]" onClick={onEdit}>Edit event</Button>}
        {onCancelEvent !== null && <CancelBooking key={`${chip.id}-event`} noun="event" onCancel={onCancelEvent} />}
      </div>
      <Button variant="ghost" size="icon" className="h-[44px] w-[44px] shrink-0" aria-label="Close event details" onClick={onClose}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </section>
  );
}
