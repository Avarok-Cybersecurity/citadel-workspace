/**
 * What a chip says, in words, so nothing about it is carried by colour or position alone (design
 * §3.9, §3.10): its time with the zone, its title or "Busy", where it comes from, and whether it
 * was cancelled. The visible text and the accessible name are both built from this.
 */
import { formatTimeIn, zoneAbbreviation } from './format';
import type { Chip } from './placement';
import type { ChipSpan } from '@/lib/calendar/placement';

export interface ChipWords {
  /** "9:00 AM", or "All day". */
  time: string;
  /** The display zone the time is on ("CST"), for rows that print it in text; null all day. */
  clock: string | null;
  /** The event's own zone, when it is not the display zone ("EDT"). */
  badge: string | null;
  title: string;
  /** "From Company", for inherited and up-pulled events. */
  from: string | null;
  cancelled: boolean;
}

export function chipWords(chip: Chip, displayZone: string, nodeName: (id: string) => string): ChipWords {
  const span: ChipSpan = chip.span;
  const time: string = span.kind === 'all_day' ? 'All day' : formatTimeIn(span.startMs, displayZone);
  const badge: string | null = span.kind === 'timed' && chip.zone !== displayZone ? zoneAbbreviation(chip.zone, span.startMs) : null;
  const clock: string | null = span.kind === 'timed' ? zoneAbbreviation(displayZone, span.startMs) : null;
  return {
    time, clock, badge,
    title: chip.title ?? 'Busy',
    from: chip.fromNode === null ? null : `From ${nodeName(chip.fromNode)}`,
    cancelled: chip.cancelled,
  };
}

/** The chip's accessible name: "Standup, 9:00 AM to 9:30 AM EDT, From Company, cancelled". */
export function chipLabel(chip: Chip, displayZone: string, nodeName: (id: string) => string): string {
  const words: ChipWords = chipWords(chip, displayZone, nodeName);
  const span: ChipSpan = chip.span;
  const when: string = span.kind === 'all_day'
    ? 'all day'
    : `${words.time} to ${formatTimeIn(span.endMs, displayZone)} ${words.clock ?? ''}`;
  return [words.title, when, words.from, words.cancelled ? 'cancelled' : null].filter((part: string | null): part is string => part !== null).join(', ');
}
